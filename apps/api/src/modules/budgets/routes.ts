import { budgetInputSchema, monthSchema, type Currency, type Scope } from '@mypersonalfinance/shared';
import Decimal from 'decimal.js';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { budgetItems, budgets, categories, recurringExpenses } from '../../db/schema';
import { assertCanEdit, assertMembers, assertOwners, canSee } from '../../lib/access';
import { monthRange, previousMonth } from '../../lib/dates';
import { badRequest, notFound } from '../../lib/errors';
import { FxResolver } from '../../lib/fx';
import { currentUser, type AuthUser } from '../../plugins/auth';
import { occurrencesInMonth } from '@mypersonalfinance/shared';
import { templateSchedule } from '../recurring-expenses/service';
import { loadExpenses } from '../reports/data';

const monthParams = z.object({ month: monthSchema });
const keyOf = (i: { categoryId: string | null; scope: Scope; ownerUserId: string | null }) =>
  `${i.categoryId}|${i.scope}|${i.ownerUserId ?? ''}`;

export const budgetRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const getBudget = async (householdId: string, month: string) => {
    const [budget] = await db
      .select()
      .from(budgets)
      .where(and(eq(budgets.householdId, householdId), eq(budgets.month, `${month}-01`)));
    return budget ?? null;
  };

  const buildView = async (user: AuthUser, month: string) => {
    const budget = await getBudget(user.householdId, month);
    const currency: Currency = budget?.currency ?? user.defaultCurrency;
    const { from, to } = monthRange(month);
    const items = budget
      ? (await db.select().from(budgetItems).where(eq(budgetItems.budgetId, budget.id))).filter((i) =>
          canSee(user, i.ownerUserId),
        )
      : [];
    const cats = await db.select().from(categories).where(eq(categories.householdId, user.householdId));
    const catById = new Map(cats.map((c) => [c.id, c]));

    // Actuals by category + scope + owner, converted to the budget currency.
    const fx = await FxResolver.load(db, user.householdId);
    const missing = new Set<string>();
    const actual = new Map<string, { paid: Decimal; pending: Decimal }>();
    for (const e of await loadExpenses(db, user.householdId, from, to)) {
      if (!canSee(user, e.ownerUserId)) continue;
      const value = fx.convert(e.amount, e.currency, currency, e.date);
      if (value === null) {
        missing.add(`${e.currency}>${currency}`);
        continue;
      }
      const key = keyOf(e);
      const acc = actual.get(key) ?? { paid: new Decimal(0), pending: new Decimal(0) };
      acc[e.status] = acc[e.status].plus(value);
      actual.set(key, acc);
    }

    const zero = { paid: new Decimal(0), pending: new Decimal(0) };
    const rows = items.map((i) => {
      const a = actual.get(keyOf(i)) ?? zero;
      const cat = catById.get(i.categoryId);
      return {
        id: i.id,
        categoryId: i.categoryId,
        categoryName: cat?.name ?? '—',
        color: cat?.color ?? null,
        nature: cat?.defaultNature ?? 'variable',
        scope: i.scope,
        ownerUserId: i.ownerUserId,
        plannedAmount: i.plannedAmount,
        actual: a.paid.toFixed(2),
        pending: a.pending.toFixed(2),
        remaining: new Decimal(i.plannedAmount).minus(a.paid).minus(a.pending).toFixed(2),
      };
    });
    const budgeted = new Set(items.map(keyOf));
    const unbudgeted = [...actual.entries()]
      .filter(([key]) => !budgeted.has(key))
      .map(([key, a]) => {
        const [categoryId, scope, ownerUserId] = key.split('|');
        const cat = categoryId && categoryId !== 'null' ? catById.get(categoryId) : undefined;
        return {
          categoryId: cat?.id ?? null,
          categoryName: cat?.name ?? 'Sin categoría',
          scope: scope as Scope,
          ownerUserId: ownerUserId || null,
          actual: a.paid.toFixed(2),
          pending: a.pending.toFixed(2),
        };
      });

    // Fixed expenses of the month, to pre-fill the plan.
    const templates = await db
      .select()
      .from(recurringExpenses)
      .where(and(eq(recurringExpenses.householdId, user.householdId), eq(recurringExpenses.active, true)));
    const suggestions = new Map<string, { categoryId: string; scope: Scope; ownerUserId: string | null; amount: Decimal }>();
    for (const t of templates) {
      if (!t.categoryId || !canSee(user, t.ownerUserId)) continue;
      const n = occurrencesInMonth(templateSchedule(t), month).length;
      const value = n ? fx.convert(new Decimal(t.amount).times(n), t.currency, currency, from) : null;
      if (!value) continue;
      const key = keyOf(t);
      const s = suggestions.get(key) ?? { categoryId: t.categoryId, scope: t.scope, ownerUserId: t.ownerUserId, amount: new Decimal(0) };
      s.amount = s.amount.plus(value);
      suggestions.set(key, s);
    }

    const sum = (values: string[]) => values.reduce((acc, v) => acc.plus(v), new Decimal(0)).toFixed(2);
    return {
      month,
      currency,
      budgetId: budget?.id ?? null,
      items: rows,
      unbudgeted,
      suggestions: [...suggestions.values()].map((s) => ({ ...s, amount: s.amount.toFixed(2) })),
      totals: {
        planned: sum(rows.map((r) => r.plannedAmount)),
        actual: sum([...rows.map((r) => r.actual), ...unbudgeted.map((u) => u.actual)]),
        pending: sum([...rows.map((r) => r.pending), ...unbudgeted.map((u) => u.pending)]),
      },
      missingRates: [...missing],
    };
  };

  app.get('/budgets/:month', { preHandler: app.authenticate, schema: { params: monthParams } }, async (request) =>
    buildView(currentUser(request), request.params.month),
  );

  /** Replaces the plan of the month (only the items the user can see). */
  app.put(
    '/budgets/:month',
    { preHandler: app.requireWriter, schema: { params: monthParams, body: budgetInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const { month } = request.params;
      const input = request.body;
      const items = input.items.map((i) => ({ ...i, ownerUserId: i.scope === 'personal' ? (i.ownerUserId ?? user.id) : null }));
      for (const i of items) assertCanEdit(user, i.ownerUserId);
      await assertOwners(db, user.householdId, items.map((i) => i.ownerUserId));
      const categoryIds = [...new Set(items.map((i) => i.categoryId))];
      if (categoryIds.length) {
        const found = await db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.householdId, user.householdId), inArray(categories.id, categoryIds)));
        if (found.length !== categoryIds.length) throw badRequest('Categoría inválida');
      }
      if (new Set(items.map(keyOf)).size !== items.length) throw badRequest('Hay partidas repetidas');

      await db.transaction(async (tx) => {
        const [budget] = await tx
          .insert(budgets)
          .values({ householdId: user.householdId, month: `${month}-01`, currency: input.currency })
          .onConflictDoUpdate({ target: [budgets.householdId, budgets.month], set: { currency: input.currency } })
          .returning();
        const existing = await tx.select().from(budgetItems).where(eq(budgetItems.budgetId, budget!.id));
        const replaceable = existing.filter((i) => canSee(user, i.ownerUserId)).map((i) => i.id);
        if (replaceable.length) await tx.delete(budgetItems).where(inArray(budgetItems.id, replaceable));
        if (items.length) await tx.insert(budgetItems).values(items.map((i) => ({ ...i, budgetId: budget!.id })));
      });
      return buildView(user, month);
    },
  );

  app.post(
    '/budgets/:month/copy-previous',
    { preHandler: app.requireWriter, schema: { params: monthParams } },
    async (request) => {
      const user = currentUser(request);
      const { month } = request.params;
      const prev = await getBudget(user.householdId, previousMonth(month));
      if (!prev) throw notFound('El mes anterior no tiene presupuesto');
      const prevItems = await db.select().from(budgetItems).where(eq(budgetItems.budgetId, prev.id));
      await db.transaction(async (tx) => {
        const [budget] = await tx
          .insert(budgets)
          .values({ householdId: user.householdId, month: `${month}-01`, currency: prev.currency })
          .onConflictDoNothing()
          .returning();
        const target = budget ?? (await getBudget(user.householdId, month))!;
        if (prevItems.length) {
          await tx
            .insert(budgetItems)
            .values(prevItems.map(({ id: _id, budgetId: _b, ...i }) => ({ ...i, budgetId: target.id })))
            .onConflictDoNothing();
        }
      });
      return buildView(user, month);
    },
  );
};
