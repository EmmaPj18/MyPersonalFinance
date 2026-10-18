import { splitByPct } from '@mypersonalfinance/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { expenses, expenseSplits, incomeEntries, incomeSources, incomeSplits, users } from '../../db/schema';
import { resolveSplits } from '../../lib/access';

const CHUNK = 500;
const chunks = <T>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

/**
 * Applies the members' current default split to every shared expense and income without a custom
 * split, so balances follow the household settings. Records that involve an ex-member keep their
 * split: it is history of when that person was in the household.
 */
export const applyDefaultSplits = async (db: DbOrTx, householdId: string) => {
  const splits = await resolveSplits(db, householdId, undefined);
  const members = new Set((await db.select({ id: users.id }).from(users).where(eq(users.householdId, householdId))).map((m) => m.id));
  const hasExMember = (rows: { recordId: string; userId: string }[]) =>
    new Set(rows.filter((r) => !members.has(r.userId)).map((r) => r.recordId));

  const sharedExpenses = await db
    .select({ id: expenses.id, amount: expenses.amount })
    .from(expenses)
    .where(and(eq(expenses.householdId, householdId), eq(expenses.scope, 'shared'), eq(expenses.customSplit, false)));
  let frozen = new Set<string>();
  for (const ids of chunks(sharedExpenses.map((e) => e.id))) {
    const rows = await db.select({ recordId: expenseSplits.expenseId, userId: expenseSplits.userId }).from(expenseSplits).where(inArray(expenseSplits.expenseId, ids));
    frozen = new Set([...frozen, ...hasExMember(rows)]);
  }
  const expenseTargets = sharedExpenses.filter((e) => !frozen.has(e.id));
  for (const batch of chunks(expenseTargets)) {
    await db.delete(expenseSplits).where(inArray(expenseSplits.expenseId, batch.map((e) => e.id)));
    const rows = batch.flatMap((e) => {
      const amounts = splitByPct(e.amount, splits.map((s) => s.sharePct));
      return splits.map((s, i) => ({ expenseId: e.id, userId: s.userId, sharePct: String(s.sharePct), shareAmount: amounts[i]! }));
    });
    if (rows.length) await db.insert(expenseSplits).values(rows);
  }

  const sharedIncome = await db
    .select({ id: incomeEntries.id })
    .from(incomeEntries)
    .innerJoin(incomeSources, eq(incomeSources.id, incomeEntries.sourceId))
    .where(and(eq(incomeEntries.householdId, householdId), eq(incomeSources.scope, 'shared'), eq(incomeEntries.customSplit, false)));
  frozen = new Set<string>();
  for (const ids of chunks(sharedIncome.map((e) => e.id))) {
    const rows = await db.select({ recordId: incomeSplits.incomeEntryId, userId: incomeSplits.userId }).from(incomeSplits).where(inArray(incomeSplits.incomeEntryId, ids));
    frozen = new Set([...frozen, ...hasExMember(rows)]);
  }
  const incomeTargets = sharedIncome.filter((e) => !frozen.has(e.id));
  for (const batch of chunks(incomeTargets)) {
    await db.delete(incomeSplits).where(inArray(incomeSplits.incomeEntryId, batch.map((e) => e.id)));
    const rows = batch.flatMap((e) => splits.map((s) => ({ incomeEntryId: e.id, userId: s.userId, sharePct: String(s.sharePct) })));
    if (rows.length) await db.insert(incomeSplits).values(rows);
  }
  return { expenses: expenseTargets.length, incomes: incomeTargets.length };
};
