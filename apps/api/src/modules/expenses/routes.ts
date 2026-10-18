import {
  expenseFiltersSchema,
  expenseInputSchema,
  idParamsSchema,
  payExpenseInputSchema,
  reassignInputSchema,
} from '@mypersonalfinance/shared';
import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accounts, auditLog, categories, expenses, expenseSplits, recurringExpenses, users } from '../../db/schema';
import { assertCanEdit, assertInHousehold, assertMembers, assertOwners, resolveOwner, resolveSplits, visibilityFilter } from '../../lib/access';
import { writeAudit } from '../../lib/audit';
import { monthRange } from '../../lib/dates';
import { notFound } from '../../lib/errors';
import { currentUser, type AuthUser } from '../../plugins/auth';
import { syncDebtPayment } from '../debts/service';
import { currentSplits, reassignExpense, writeSplits } from './service';

export const expenseRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const findExpense = async (user: AuthUser, id: string) => {
    const [row] = await db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.id, id),
          eq(expenses.householdId, user.householdId),
          visibilityFilter(user, expenses.ownerUserId, expenses.scope),
        ),
      );
    if (!row) throw notFound('Gasto no encontrado');
    return row;
  };

  app.get(
    '/expenses',
    { preHandler: app.authenticate, schema: { querystring: expenseFiltersSchema } },
    async (request) => {
      const user = currentUser(request);
      const f = request.query;
      const range = f.month ? monthRange(f.month) : { from: f.from, to: f.to };
      const conditions: (SQL | undefined)[] = [
        eq(expenses.householdId, user.householdId),
        visibilityFilter(user, expenses.ownerUserId, expenses.scope),
        range.from ? gte(expenses.date, range.from) : undefined,
        range.to ? lte(expenses.date, range.to) : undefined,
        f.categoryId ? eq(expenses.categoryId, f.categoryId) : undefined,
        f.accountId ? eq(expenses.accountId, f.accountId) : undefined,
        f.ownerUserId ? eq(expenses.ownerUserId, f.ownerUserId) : undefined,
        f.paidByUserId ? eq(expenses.paidByUserId, f.paidByUserId) : undefined,
        f.nature ? eq(expenses.nature, f.nature) : undefined,
        f.scope ? eq(expenses.scope, f.scope) : undefined,
        f.status ? eq(expenses.status, f.status) : undefined,
      ];
      const rows = await db
        .select({
          expense: expenses,
          categoryName: categories.name,
          categoryColor: categories.color,
          accountName: accounts.name,
        })
        .from(expenses)
        .leftJoin(categories, eq(categories.id, expenses.categoryId))
        .leftJoin(accounts, eq(accounts.id, expenses.accountId))
        .where(and(...conditions))
        .orderBy(desc(expenses.date), desc(expenses.createdAt))
        .limit(2000);
      const ids = rows.map((r) => r.expense.id);
      const splits = ids.length
        ? await db.select().from(expenseSplits).where(inArray(expenseSplits.expenseId, ids))
        : [];
      return rows.map(({ expense, ...rest }) => ({
        ...expense,
        ...rest,
        splits: splits
          .filter((s) => s.expenseId === expense.id)
          .map(({ userId, sharePct, shareAmount }) => ({ userId, sharePct, shareAmount })),
      }));
    },
  );

  const validateRefs = async (user: AuthUser, input: { categoryId?: string | null; accountId?: string | null; paidByUserId?: string | null }) => {
    await assertInHousehold(db, categories, input.categoryId, user.householdId, 'categoría');
    await assertInHousehold(db, accounts, input.accountId, user.householdId, 'cuenta');
    await assertMembers(db, user.householdId, [input.paidByUserId]);
  };

  app.post('/expenses', { preHandler: app.requireWriter, schema: { body: expenseInputSchema } }, async (request, reply) => {
    const user = currentUser(request);
    const { splits: splitInput, ...input } = request.body;
    const ownerUserId = resolveOwner(user, input.scope, input.ownerUserId);
    await assertOwners(db, user.householdId, [ownerUserId]);
    assertCanEdit(user, ownerUserId);
    await validateRefs(user, input);
    const splits = input.scope === 'shared' ? await resolveSplits(db, user.householdId, splitInput) : [];

    const result = await db.transaction(async (tx) => {
      const [expense] = await tx
        .insert(expenses)
        .values({
          ...input,
          ownerUserId,
          paidByUserId: input.paidByUserId ?? user.id,
          householdId: user.householdId,
          createdBy: user.id,
        })
        .returning();
      const rows = await writeSplits(tx, expense!.id, expense!.amount, splits);
      return { ...expense!, splits: rows };
    });
    return reply.status(201).send(result);
  });

  app.put(
    '/expenses/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: expenseInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const existing = await findExpense(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      const { splits: splitInput, ...input } = request.body;
      const ownerUserId = resolveOwner(user, input.scope, input.ownerUserId);
      await assertOwners(db, user.householdId, [ownerUserId]);
      assertCanEdit(user, ownerUserId);
      await validateRefs(user, input);
      // Keep the current split when editing a shared expense without sending a new one.
      const splits =
        input.scope === 'shared'
          ? await resolveSplits(
              db,
              user.householdId,
              splitInput ?? (existing.scope === 'shared' ? await currentSplits(db, existing.id) : undefined),
            )
          : [];

      return db.transaction(async (tx) => {
        const [expense] = await tx
          .update(expenses)
          .set({ ...input, ownerUserId, paidByUserId: input.paidByUserId ?? existing.paidByUserId, isEstimated: false })
          .where(eq(expenses.id, existing.id))
          .returning();
        const rows = await writeSplits(tx, expense!.id, expense!.amount, splits);
        if (existing.scope !== expense!.scope || existing.ownerUserId !== expense!.ownerUserId) {
          await writeAudit(tx, {
            householdId: user.householdId,
            userId: user.id,
            entity: 'expense',
            entityId: existing.id,
            action: 'reassign',
            before: { scope: existing.scope, ownerUserId: existing.ownerUserId },
            after: { scope: expense!.scope, ownerUserId: expense!.ownerUserId },
          });
        }
        return { ...expense!, splits: rows };
      });
    },
  );

  app.delete(
    '/expenses/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      const existing = await findExpense(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      await db.transaction(async (tx) => {
        await tx.delete(expenses).where(eq(expenses.id, existing.id));
        await writeAudit(tx, {
          householdId: user.householdId,
          userId: user.id,
          entity: 'expense',
          entityId: existing.id,
          action: 'delete',
          before: existing,
        });
      });
      return reply.status(204).send();
    },
  );

  /** Marks a pending (fixed) expense as paid, optionally with the real amount. */
  app.post(
    '/expenses/:id/pay',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: payExpenseInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const existing = await findExpense(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      await validateRefs(user, request.body);
      const { amount, date, accountId, paidByUserId } = request.body;
      return db.transaction(async (tx) => {
        const [expense] = await tx
          .update(expenses)
          .set({
            status: 'paid',
            isEstimated: false,
            amount: amount ?? existing.amount,
            date: date ?? existing.date,
            accountId: accountId === undefined ? existing.accountId : accountId,
            paidByUserId: paidByUserId ?? user.id,
          })
          .where(eq(expenses.id, existing.id))
          .returning();
        if (expense!.scope === 'shared' && expense!.amount !== existing.amount) {
          await writeSplits(tx, expense!.id, expense!.amount, await currentSplits(tx, expense!.id));
        }
        if (expense!.recurringExpenseId) {
          const [template] = await tx
            .select({ debtId: recurringExpenses.debtId })
            .from(recurringExpenses)
            .where(eq(recurringExpenses.id, expense!.recurringExpenseId));
          if (template?.debtId) await syncDebtPayment(tx, template.debtId, expense!);
        }
        return expense;
      });
    },
  );

  app.post(
    '/expenses/:id/reassign',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: reassignInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const existing = await findExpense(user, request.params.id);
      return db.transaction((tx) => reassignExpense(tx, user, existing, request.body));
    },
  );

  app.get(
    '/expenses/:id/history',
    { preHandler: app.authenticate, schema: { params: idParamsSchema } },
    async (request) => {
      const user = currentUser(request);
      const existing = await findExpense(user, request.params.id);
      return db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          before: auditLog.before,
          after: auditLog.after,
          at: auditLog.at,
          userName: users.name,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(
          and(
            eq(auditLog.householdId, user.householdId),
            eq(auditLog.entity, 'expense'),
            eq(auditLog.entityId, existing.id),
          ),
        )
        .orderBy(desc(auditLog.at));
    },
  );
};
