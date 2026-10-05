import {
  idParamsSchema,
  monthSchema,
  reassignInputSchema,
  recurringExpenseInputSchema,
  type SplitInput,
} from '@mypersonalfinance/shared';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accounts, categories, expenses, recurringExpenses, recurringExpenseSplits } from '../../db/schema';
import { assertCanEdit, assertInHousehold, assertMembers, resolveOwner, resolveSplits, visibilityFilter } from '../../lib/access';
import { writeAudit } from '../../lib/audit';
import { toIsoDate } from '../../lib/dates';
import { notFound } from '../../lib/errors';
import { currentUser, type AuthUser } from '../../plugins/auth';
import type { Database } from '../../db/client';
import { reassignExpense, writeSplits } from '../expenses/service';
import { occurrencesInMonth } from './occurrences';

/** Creates the pending expenses of every active fixed expense for the month. Idempotent. */
export const generateMonth = async (db: Database, householdId: string, month: string, actorId: string | null) => {
  const templates = await db
    .select()
    .from(recurringExpenses)
    .where(and(eq(recurringExpenses.householdId, householdId), eq(recurringExpenses.active, true)));
  if (templates.length === 0) return { created: 0 };
  const templateSplits = await db
    .select()
    .from(recurringExpenseSplits)
    .where(inArray(recurringExpenseSplits.recurringExpenseId, templates.map((t) => t.id)));

  let created = 0;
  await db.transaction(async (tx) => {
    for (const t of templates) {
      for (const date of occurrencesInMonth(t, month)) {
        const [expense] = await tx
          .insert(expenses)
          .values({
            householdId,
            categoryId: t.categoryId,
            accountId: t.accountId,
            amount: t.amount,
            currency: t.currency,
            date,
            description: t.name,
            nature: 'fixed',
            scope: t.scope,
            ownerUserId: t.ownerUserId,
            recurringExpenseId: t.id,
            status: 'pending',
            createdBy: actorId,
          })
          .onConflictDoNothing()
          .returning();
        if (!expense) continue;
        created++;
        if (t.scope === 'shared') {
          const own = templateSplits
            .filter((s) => s.recurringExpenseId === t.id)
            .map((s) => ({ userId: s.userId, sharePct: Number(s.sharePct) }));
          await writeSplits(tx, expense.id, expense.amount, await resolveSplits(tx, householdId, own.length ? own : undefined));
        }
      }
    }
  });
  return { created };
};

export const recurringExpenseRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const findTemplate = async (user: AuthUser, id: string) => {
    const [row] = await db
      .select()
      .from(recurringExpenses)
      .where(
        and(
          eq(recurringExpenses.id, id),
          eq(recurringExpenses.householdId, user.householdId),
          visibilityFilter(user, recurringExpenses.ownerUserId, recurringExpenses.scope),
        ),
      );
    if (!row) throw notFound('Gasto fijo no encontrado');
    return row;
  };

  const writeTemplateSplits = async (tx: Parameters<Parameters<Database['transaction']>[0]>[0], id: string, splits: SplitInput[]) => {
    await tx.delete(recurringExpenseSplits).where(eq(recurringExpenseSplits.recurringExpenseId, id));
    if (splits.length) {
      await tx
        .insert(recurringExpenseSplits)
        .values(splits.map((s) => ({ recurringExpenseId: id, userId: s.userId, sharePct: String(s.sharePct) })));
    }
  };

  app.get('/recurring-expenses', { preHandler: app.authenticate }, async (request) => {
    const user = currentUser(request);
    const rows = await db
      .select({ template: recurringExpenses, categoryName: categories.name })
      .from(recurringExpenses)
      .leftJoin(categories, eq(categories.id, recurringExpenses.categoryId))
      .where(
        and(
          eq(recurringExpenses.householdId, user.householdId),
          visibilityFilter(user, recurringExpenses.ownerUserId, recurringExpenses.scope),
        ),
      )
      .orderBy(recurringExpenses.dueDay, recurringExpenses.name);
    const splits = rows.length
      ? await db
          .select()
          .from(recurringExpenseSplits)
          .where(inArray(recurringExpenseSplits.recurringExpenseId, rows.map((r) => r.template.id)))
      : [];
    return rows.map(({ template, categoryName }) => ({
      ...template,
      categoryName,
      splits: splits
        .filter((s) => s.recurringExpenseId === template.id)
        .map(({ userId, sharePct }) => ({ userId, sharePct })),
    }));
  });

  const save = async (user: AuthUser, body: typeof recurringExpenseInputSchema._output, id?: string) => {
    const { splits: splitInput, ...input } = body;
    const ownerUserId = resolveOwner(user, input.scope, input.ownerUserId);
    await assertMembers(db, user.householdId, [ownerUserId]);
    assertCanEdit(user, ownerUserId);
    await assertInHousehold(db, categories, input.categoryId, user.householdId, 'categoría');
    await assertInHousehold(db, accounts, input.accountId, user.householdId, 'cuenta');
    // Explicit split is stored; otherwise occurrences use the members' default split.
    const splits = input.scope === 'shared' && splitInput?.length ? await resolveSplits(db, user.householdId, splitInput) : [];
    return db.transaction(async (tx) => {
      const data = { ...input, ownerUserId };
      const [row] = id
        ? await tx.update(recurringExpenses).set(data).where(eq(recurringExpenses.id, id)).returning()
        : await tx.insert(recurringExpenses).values({ ...data, householdId: user.householdId }).returning();
      await writeTemplateSplits(tx, row!.id, splits);
      return { ...row!, splits };
    });
  };

  app.post(
    '/recurring-expenses',
    { preHandler: app.requireWriter, schema: { body: recurringExpenseInputSchema } },
    async (request, reply) => reply.status(201).send(await save(currentUser(request), request.body)),
  );

  app.put(
    '/recurring-expenses/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: recurringExpenseInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const existing = await findTemplate(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      return save(user, request.body, existing.id);
    },
  );

  /** Deletes the template and its still-pending occurrences; paid ones stay as history. */
  app.delete(
    '/recurring-expenses/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      const existing = await findTemplate(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      await db.transaction(async (tx) => {
        await tx
          .delete(expenses)
          .where(and(eq(expenses.recurringExpenseId, existing.id), eq(expenses.status, 'pending')));
        await tx.delete(recurringExpenses).where(eq(recurringExpenses.id, existing.id));
      });
      return reply.status(204).send();
    },
  );

  app.post(
    '/recurring-expenses/generate',
    { preHandler: app.requireWriter, schema: { querystring: z.object({ month: monthSchema }) } },
    async (request) => {
      const user = currentUser(request);
      return generateMonth(db, user.householdId, request.query.month, user.id);
    },
  );

  /**
   * Changes the owner of a fixed expense. apply=future also reassigns its pending occurrences
   * from today on; apply=all reassigns every generated occurrence (paid ones included).
   */
  app.post(
    '/recurring-expenses/:id/reassign',
    {
      preHandler: app.requireWriter,
      schema: {
        params: idParamsSchema,
        querystring: z.object({ apply: z.enum(['future', 'all']).default('future') }),
        body: reassignInputSchema,
      },
    },
    async (request) => {
      const user = currentUser(request);
      const existing = await findTemplate(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      const input = request.body;
      const ownerUserId = input.scope === 'personal' ? input.ownerUserId! : null;
      await assertMembers(db, user.householdId, [ownerUserId]);
      const splits = input.scope === 'shared' && input.splits?.length ? await resolveSplits(db, user.householdId, input.splits) : [];

      return db.transaction(async (tx) => {
        const [template] = await tx
          .update(recurringExpenses)
          .set({ scope: input.scope, ownerUserId })
          .where(eq(recurringExpenses.id, existing.id))
          .returning();
        await writeTemplateSplits(tx, existing.id, splits);
        await writeAudit(tx, {
          householdId: user.householdId,
          userId: user.id,
          entity: 'recurring_expense',
          entityId: existing.id,
          action: 'reassign',
          before: { scope: existing.scope, ownerUserId: existing.ownerUserId },
          after: { scope: input.scope, ownerUserId, splits, apply: request.query.apply },
        });
        const occurrences = await tx
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.recurringExpenseId, existing.id),
              ...(request.query.apply === 'future'
                ? [eq(expenses.status, 'pending'), gte(expenses.date, toIsoDate(new Date()))]
                : []),
            ),
          );
        for (const occurrence of occurrences) {
          await reassignExpense(tx, user, occurrence, input);
        }
        return { ...template!, splits, reassignedOccurrences: occurrences.length };
      });
    },
  );
};
