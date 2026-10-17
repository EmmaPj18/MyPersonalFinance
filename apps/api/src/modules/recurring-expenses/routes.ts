import {
  idParamsSchema,
  nextOccurrence,
  reassignInputSchema,
  recurringExpenseInputSchema,
  upcomingQuerySchema,
  type SplitInput,
} from '@mypersonalfinance/shared';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accounts, categories, expenses, households, recurringExpenses, recurringExpenseSplits } from '../../db/schema';
import { assertCanEdit, assertInHousehold, assertMembers, assertOwners, resolveOwner, resolveSplits, visibilityFilter } from '../../lib/access';
import { writeAudit } from '../../lib/audit';
import { addDays, todayIn, toIsoDate } from '../../lib/dates';
import { runRecurring } from '../../jobs/recurring';
import { badRequest, notFound } from '../../lib/errors';
import { currentUser, type AuthUser } from '../../plugins/auth';
import type { Tx } from '../../db/client';
import { reassignExpense, writeSplits } from '../expenses/service';
import { templateSchedule, upcomingDates } from './service';

export const recurringExpenseRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const householdToday = async (householdId: string) => {
    const [h] = await db.select({ timezone: households.timezone }).from(households).where(eq(households.id, householdId));
    return todayIn(h?.timezone ?? 'America/Santo_Domingo');
  };

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

  const writeTemplateSplits = async (tx: Tx, id: string, splits: SplitInput[]) => {
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
    const today = await householdToday(user.householdId);
    return rows.map(({ template, categoryName }) => ({
      ...template,
      categoryName,
      nextDate: template.active
        ? nextOccurrence(
            templateSchedule(template),
            template.generatedThrough && template.generatedThrough > today ? template.generatedThrough : today,
          )
        : null,
      splits: splits
        .filter((s) => s.recurringExpenseId === template.id)
        .map(({ userId, sharePct }) => ({ userId, sharePct })),
    }));
  });

  const save = async (user: AuthUser, body: typeof recurringExpenseInputSchema._output, id?: string) => {
    const { splits: splitInput, linkExpenseId, ...input } = body;
    const ownerUserId = resolveOwner(user, input.scope, input.ownerUserId);
    await assertOwners(db, user.householdId, [ownerUserId]);
    assertCanEdit(user, ownerUserId);
    await assertInHousehold(db, categories, input.categoryId, user.householdId, 'categoría');
    await assertInHousehold(db, accounts, input.accountId, user.householdId, 'cuenta');
    await assertMembers(db, user.householdId, [input.paidByUserId]);
    if (input.frequency === 'semimonthly' && !input.secondDueDay) throw badRequest('Indica el segundo día de pago');
    const linked = linkExpenseId ? await findLinkable(user, linkExpenseId) : null;
    // Explicit split is stored; otherwise occurrences use the members' default split.
    const splits = input.scope === 'shared' && splitInput?.length ? await resolveSplits(db, user.householdId, splitInput) : [];
    const saved = await db.transaction(async (tx) => {
      const data = { ...input, ownerUserId, paidByUserId: input.paidByUserId ?? ownerUserId ?? user.id };
      // A new schedule starts at its start date; an expense being converted is its first occurrence.
      const [row] = id
        ? await tx.update(recurringExpenses).set(data).where(eq(recurringExpenses.id, id)).returning()
        : await tx
            .insert(recurringExpenses)
            .values({
              ...data,
              householdId: user.householdId,
              generatedThrough: linked ? linked.date : addDays(input.startDate, -1),
            })
            .returning();
      await writeTemplateSplits(tx, row!.id, splits);
      if (linked) {
        await tx.update(expenses).set({ recurringExpenseId: row!.id, nature: 'fixed' }).where(eq(expenses.id, linked.id));
      }
      return { ...row!, splits };
    });
    // Register right away any occurrence that's already due.
    await runRecurring(db, { householdId: user.householdId });
    return saved;
  };

  const findLinkable = async (user: AuthUser, expenseId: string) => {
    const [row] = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.householdId, user.householdId)));
    if (!row) throw notFound('Gasto no encontrado');
    if (row.recurringExpenseId) throw badRequest('Ese gasto ya pertenece a un gasto fijo');
    assertCanEdit(user, row.ownerUserId);
    return row;
  };

  /** Occurrences still to come (projections, not stored). */
  app.get(
    '/recurring-expenses/upcoming',
    { preHandler: app.authenticate, schema: { querystring: upcomingQuerySchema } },
    async (request) => {
      const user = currentUser(request);
      const today = await householdToday(user.householdId);
      const until = addDays(today, request.query.days);
      const rows = await db
        .select({ template: recurringExpenses, categoryName: categories.name, categoryColor: categories.color })
        .from(recurringExpenses)
        .leftJoin(categories, eq(categories.id, recurringExpenses.categoryId))
        .where(
          and(
            eq(recurringExpenses.householdId, user.householdId),
            eq(recurringExpenses.active, true),
            visibilityFilter(user, recurringExpenses.ownerUserId, recurringExpenses.scope),
          ),
        );
      return rows
        .flatMap(({ template: t, categoryName, categoryColor }) =>
          upcomingDates(templateSchedule(t), t.generatedThrough, today, until).map((date) => ({
            recurringExpenseId: t.id,
            name: t.name,
            date,
            amount: t.amount,
            currency: t.currency,
            scope: t.scope,
            ownerUserId: t.ownerUserId,
            categoryName,
            categoryColor,
            isVariableAmount: t.isVariableAmount,
            autoPay: t.autoPay,
          })),
        )
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  );

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
      await assertOwners(db, user.householdId, [ownerUserId]);
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
