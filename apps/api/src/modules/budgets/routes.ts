import {
  budgetPlanInputSchema,
  computeNet,
  copyBudgetInputSchema,
  occurrencesInMonth,
  yearParamsSchema,
  type BudgetLineKind,
  type Currency,
  type ExpenseNature,
  type Scope,
} from '@mypersonalfinance/shared';
import Decimal from 'decimal.js';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DbOrTx } from '../../db/client';
import {
  budgetLineAmounts,
  budgetLines,
  budgetPlans,
  categories,
  goalContributions,
  incomeSources,
  recurringExpenses,
  savingsGoals,
  sourceDeductionTemplates,
} from '../../db/schema';
import { assertCanEdit, assertOwners, canSee } from '../../lib/access';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { FxResolver } from '../../lib/fx';
import { currentUser, type AuthUser } from '../../plugins/auth';
import { sourceSchedule } from '../income/service';
import { templateSchedule } from '../recurring-expenses/service';
import { loadExpenses, loadIncomes } from '../reports/data';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const monthKey = (year: number, m: number) => `${year}-${String(m).padStart(2, '0')}`;
const zeros = () => MONTHS.map(() => new Decimal(0));
const fmt = (values: Decimal[]) => values.map((v) => v.toFixed(2));
const sum = (values: Decimal.Value[]) => values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));

/** Identifies what a line budgets: category + owner for expenses, the source or goal otherwise. */
const lineKey = (l: {
  kind: BudgetLineKind;
  categoryId?: string | null;
  incomeSourceId?: string | null;
  goalId?: string | null;
  scope: Scope;
  ownerUserId?: string | null;
}) =>
  l.kind === 'expense'
    ? `expense|${l.categoryId}|${l.scope}|${l.ownerUserId ?? ''}`
    : l.kind === 'income'
      ? `income|${l.incomeSourceId}`
      : `saving|${l.goalId}`;

interface SuggestedLine {
  kind: BudgetLineKind;
  categoryId: string | null;
  incomeSourceId: string | null;
  goalId: null;
  scope: Scope;
  ownerUserId: string | null;
  nature: ExpenseNature | null;
}

export const budgetRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const getPlan = async (conn: DbOrTx, householdId: string, year: number) => {
    const [plan] = await conn
      .select()
      .from(budgetPlans)
      .where(and(eq(budgetPlans.householdId, householdId), eq(budgetPlans.year, year)));
    return plan ?? null;
  };

  const linesOf = async (conn: DbOrTx, planId: string) => {
    const lines = await conn.select().from(budgetLines).where(eq(budgetLines.planId, planId)).orderBy(budgetLines.sortOrder);
    const amounts = lines.length
      ? await conn.select().from(budgetLineAmounts).where(inArray(budgetLineAmounts.lineId, lines.map((l) => l.id)))
      : [];
    return lines.map((l) => {
      const plan = zeros();
      for (const a of amounts) if (a.lineId === l.id) plan[a.month - 1] = new Decimal(a.amount);
      return { ...l, plan };
    });
  };

  const buildView = async (user: AuthUser, year: number) => {
    const plan = await getPlan(db, user.householdId, year);
    const currency: Currency = plan?.currency ?? user.baseCurrency;
    const lines = plan ? (await linesOf(db, plan.id)).filter((l) => canSee(user, l.ownerUserId)) : [];
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    // Actuals per line key and month, converted to the plan's currency.
    const fx = await FxResolver.load(db, user.householdId);
    const missing = new Set<string>();
    const actual = new Map<string, Decimal[]>();
    const add = (key: string, date: string, amount: Decimal.Value, cur: Currency) => {
      const value = fx.convert(amount, cur, currency, date);
      if (value === null) {
        missing.add(`${cur}>${currency}`);
        return;
      }
      const row = actual.get(key) ?? zeros();
      const m = Number(date.slice(5, 7)) - 1;
      row[m] = row[m]!.plus(value);
      actual.set(key, row);
    };

    for (const e of await loadExpenses(db, user.householdId, from, to)) {
      if (!e.categoryId || !canSee(user, e.ownerUserId)) continue;
      add(lineKey({ kind: 'expense', ...e }), e.date, e.amount, e.currency);
    }
    for (const i of await loadIncomes(db, user.householdId, from, to)) {
      if (!canSee(user, i.ownerUserId)) continue;
      add(lineKey({ kind: 'income', incomeSourceId: i.sourceId, scope: i.scope }), i.payDate, i.netAmount, i.currency);
    }
    const contributions = await db
      .select({
        goalId: goalContributions.goalId,
        amount: goalContributions.amount,
        date: goalContributions.date,
        currency: savingsGoals.currency,
      })
      .from(goalContributions)
      .innerJoin(savingsGoals, eq(savingsGoals.id, goalContributions.goalId))
      .where(and(eq(savingsGoals.householdId, user.householdId), gte(goalContributions.date, from), lte(goalContributions.date, to)));
    for (const c of contributions) add(lineKey({ kind: 'saving', goalId: c.goalId, scope: 'shared' }), c.date, c.amount, c.currency);

    const [cats, sources, goals] = await Promise.all([
      db.select().from(categories).where(eq(categories.householdId, user.householdId)),
      db.select().from(incomeSources).where(eq(incomeSources.householdId, user.householdId)),
      db.select().from(savingsGoals).where(eq(savingsGoals.householdId, user.householdId)),
    ]);
    const catById = new Map(cats.map((c) => [c.id, c]));

    const budgeted = new Set(lines.map(lineKey));
    const rows = lines.map((l) => {
      const cat = l.categoryId ? catById.get(l.categoryId) : undefined;
      const name =
        l.kind === 'expense'
          ? (cat?.name ?? '—')
          : l.kind === 'income'
            ? (sources.find((s) => s.id === l.incomeSourceId)?.name ?? '—')
            : (goals.find((g) => g.id === l.goalId)?.name ?? '—');
      const act = actual.get(lineKey(l)) ?? zeros();
      return {
        id: l.id,
        kind: l.kind,
        categoryId: l.categoryId,
        incomeSourceId: l.incomeSourceId,
        goalId: l.goalId,
        scope: l.scope,
        ownerUserId: l.ownerUserId,
        nature: l.kind === 'expense' ? (l.nature ?? cat?.defaultNature ?? 'variable') : null,
        name,
        color: cat?.color ?? null,
        plan: fmt(l.plan),
        actual: fmt(act),
        planTotal: sum(l.plan).toFixed(2),
        actualTotal: sum(act).toFixed(2),
      };
    });

    // Expenses outside the plan, grouped by category and owner.
    const unbudgeted = [...actual.entries()]
      .filter(([key]) => key.startsWith('expense|') && !budgeted.has(key))
      .map(([key, values]) => {
        const [, categoryId, scope, ownerUserId] = key.split('|');
        const cat = catById.get(categoryId!);
        return {
          categoryId: categoryId!,
          name: cat?.name ?? '—',
          color: cat?.color ?? null,
          scope: scope as Scope,
          ownerUserId: ownerUserId || null,
          actual: fmt(values),
          actualTotal: sum(values).toFixed(2),
        };
      });

    const totals = (kind: BudgetLineKind) => {
      const planned = zeros();
      const real = zeros();
      const accumulate = (target: Decimal[], values: string[]) => values.forEach((v, i) => (target[i] = target[i]!.plus(v)));
      for (const r of rows.filter((x) => x.kind === kind)) {
        accumulate(planned, r.plan);
        accumulate(real, r.actual);
      }
      if (kind === 'expense') for (const u of unbudgeted) accumulate(real, u.actual);
      return { plan: fmt(planned), actual: fmt(real), planTotal: sum(planned).toFixed(2), actualTotal: sum(real).toFixed(2) };
    };

    return {
      year,
      currency,
      planId: plan?.id ?? null,
      lines: rows,
      unbudgeted,
      totals: { income: totals('income'), expense: totals('expense'), saving: totals('saving') },
      missingRates: [...missing],
    };
  };

  app.get('/budgets/:year', { preHandler: app.authenticate, schema: { params: yearParamsSchema } }, async (request) =>
    buildView(currentUser(request), request.params.year),
  );

  /** Replaces the lines of the year (only the ones the user can see). */
  app.put(
    '/budgets/:year',
    { preHandler: app.requireWriter, schema: { params: yearParamsSchema, body: budgetPlanInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const { year } = request.params;
      const { currency } = request.body;

      const [cats, sources, goals] = await Promise.all([
        db
          .select({ id: categories.id, nature: categories.defaultNature })
          .from(categories)
          .where(eq(categories.householdId, user.householdId)),
        db.select().from(incomeSources).where(eq(incomeSources.householdId, user.householdId)),
        db.select().from(savingsGoals).where(eq(savingsGoals.householdId, user.householdId)),
      ]);
      // Income and saving lines take their owner from the source/goal; expense lines say it.
      const lines = request.body.lines.map((l, sortOrder) => {
        const base = { kind: l.kind, amounts: l.amounts, sortOrder, categoryId: null, incomeSourceId: null, goalId: null, nature: null };
        if (l.kind === 'expense') {
          const cat = cats.find((c) => c.id === l.categoryId);
          if (!cat) throw badRequest('Categoría inválida');
          const ownerUserId = l.scope === 'personal' ? (l.ownerUserId ?? user.id) : null;
          return { ...base, categoryId: cat.id, scope: l.scope, ownerUserId, nature: l.nature ?? cat.nature };
        }
        if (l.kind === 'income') {
          const source = sources.find((s) => s.id === l.incomeSourceId);
          if (!source) throw badRequest('Fuente de ingreso inválida');
          return { ...base, incomeSourceId: source.id, scope: source.scope, ownerUserId: source.ownerUserId };
        }
        const goal = goals.find((g) => g.id === l.goalId);
        if (!goal) throw badRequest('Meta inválida');
        return { ...base, goalId: goal.id, scope: (goal.ownerUserId ? 'personal' : 'shared') as Scope, ownerUserId: goal.ownerUserId };
      });
      for (const l of lines) assertCanEdit(user, l.ownerUserId);
      await assertOwners(db, user.householdId, lines.filter((l) => l.kind === 'expense').map((l) => l.ownerUserId));
      if (new Set(lines.map(lineKey)).size !== lines.length) throw badRequest('Hay líneas repetidas en el presupuesto');

      await db.transaction(async (tx) => {
        const [plan] = await tx
          .insert(budgetPlans)
          .values({ householdId: user.householdId, year, currency })
          .onConflictDoUpdate({ target: [budgetPlans.householdId, budgetPlans.year], set: { currency } })
          .returning();
        const existing = await tx.select().from(budgetLines).where(eq(budgetLines.planId, plan!.id));
        const replaceable = existing.filter((l) => canSee(user, l.ownerUserId)).map((l) => l.id);
        if (replaceable.length) await tx.delete(budgetLines).where(inArray(budgetLines.id, replaceable));
        for (const { amounts, ...line } of lines) {
          const [row] = await tx.insert(budgetLines).values({ ...line, planId: plan!.id }).returning({ id: budgetLines.id });
          await tx.insert(budgetLineAmounts).values(amounts.map((amount, i) => ({ lineId: row!.id, month: i + 1, amount })));
        }
      });
      return buildView(user, year);
    },
  );

  /**
   * Suggested lines from what is already scheduled: fixed expenses (by category and owner) and
   * income sources with a pay schedule and expected amount, month by month. Nothing is saved.
   */
  app.post('/budgets/:year/suggestions', { preHandler: app.authenticate, schema: { params: yearParamsSchema } }, async (request) => {
    const user = currentUser(request);
    const { year } = request.params;
    const plan = await getPlan(db, user.householdId, year);
    const currency: Currency = plan?.currency ?? user.baseCurrency;
    const fx = await FxResolver.load(db, user.householdId);
    const suggestions = new Map<string, SuggestedLine & { values: Decimal[] }>();
    const missing = new Set<string>();
    const put = (line: SuggestedLine, m: number, amount: Decimal.Value, cur: Currency) => {
      const value = fx.convert(amount, cur, currency, `${monthKey(year, m)}-01`);
      if (value === null) {
        missing.add(`${cur}>${currency}`);
        return;
      }
      const key = lineKey(line);
      const entry = suggestions.get(key) ?? { ...line, values: zeros() };
      entry.values[m - 1] = entry.values[m - 1]!.plus(value);
      suggestions.set(key, entry);
    };

    const templates = await db
      .select()
      .from(recurringExpenses)
      .where(and(eq(recurringExpenses.householdId, user.householdId), eq(recurringExpenses.active, true)));
    let skippedWithoutCategory = 0;
    for (const t of templates) {
      if (!canSee(user, t.ownerUserId)) continue;
      if (!t.categoryId) {
        skippedWithoutCategory++;
        continue;
      }
      const line: SuggestedLine = {
        kind: 'expense',
        categoryId: t.categoryId,
        incomeSourceId: null,
        goalId: null,
        scope: t.scope,
        ownerUserId: t.ownerUserId,
        nature: 'fixed',
      };
      for (const m of MONTHS) {
        const n = occurrencesInMonth(templateSchedule(t), monthKey(year, m)).length;
        if (n) put(line, m, new Decimal(t.amount).times(n), t.currency);
      }
    }

    const sources = await db
      .select()
      .from(incomeSources)
      .where(and(eq(incomeSources.householdId, user.householdId), eq(incomeSources.isActive, true)));
    const deductionRows = sources.length
      ? await db.select().from(sourceDeductionTemplates).where(inArray(sourceDeductionTemplates.sourceId, sources.map((s) => s.id)))
      : [];
    for (const s of sources) {
      const rule = sourceSchedule(s);
      if (!rule || !s.expectedGross || !canSee(user, s.ownerUserId)) continue;
      const net = computeNet(s.expectedGross, deductionRows.filter((d) => d.sourceId === s.id).map((d) => d.defaultAmount));
      const line: SuggestedLine = {
        kind: 'income',
        categoryId: null,
        incomeSourceId: s.id,
        goalId: null,
        scope: s.scope,
        ownerUserId: s.ownerUserId,
        nature: null,
      };
      for (const m of MONTHS) {
        const n = occurrencesInMonth(rule, monthKey(year, m)).length;
        if (n) put(line, m, new Decimal(net).times(n), s.defaultCurrency);
      }
    }

    return {
      currency,
      lines: [...suggestions.values()].map(({ values, ...l }) => ({ ...l, amounts: fmt(values) })),
      skippedWithoutCategory,
      missingRates: [...missing],
    };
  });

  /** Copies the previous year's plan (optionally adjusted by a percentage) into an empty year. */
  app.post(
    '/budgets/:year/copy-previous',
    { preHandler: app.requireWriter, schema: { params: yearParamsSchema, body: copyBudgetInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const { year } = request.params;
      const previous = await getPlan(db, user.householdId, year - 1);
      if (!previous) throw notFound(`${year - 1} no tiene presupuesto`);
      const current = await getPlan(db, user.householdId, year);
      if (current && (await linesOf(db, current.id)).length) throw conflict(`${year} ya tiene presupuesto`);
      const factor = new Decimal(1).plus(new Decimal(request.body.adjustPct).div(100));
      const lines = (await linesOf(db, previous.id)).filter((l) => canSee(user, l.ownerUserId));

      await db.transaction(async (tx) => {
        const [plan] = await tx
          .insert(budgetPlans)
          .values({ householdId: user.householdId, year, currency: previous.currency })
          .onConflictDoUpdate({ target: [budgetPlans.householdId, budgetPlans.year], set: { currency: previous.currency } })
          .returning();
        for (const { id: _id, planId: _planId, plan: amounts, ...line } of lines) {
          const [row] = await tx.insert(budgetLines).values({ ...line, planId: plan!.id }).returning({ id: budgetLines.id });
          await tx
            .insert(budgetLineAmounts)
            .values(amounts.map((a, i) => ({ lineId: row!.id, month: i + 1, amount: a.times(factor).toFixed(2) })));
        }
      });
      return buildView(user, year);
    },
  );
};
