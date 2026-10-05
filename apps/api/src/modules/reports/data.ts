import type {
  Currency,
  DeductionCategory,
  ExpenseNature,
  ExpenseStatus,
  IncomeKind,
  IncomeSourceType,
  Scope,
} from '@mypersonalfinance/shared';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import {
  categories,
  deductionTypes,
  expenses,
  expenseSplits,
  incomeDeductions,
  incomeEntries,
  incomeSources,
  incomeSplits,
} from '../../db/schema';

export interface ShareRow {
  userId: string;
  sharePct: number;
}

export interface ExpenseRow {
  id: string;
  date: string;
  amount: string;
  currency: Currency;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  nature: ExpenseNature;
  scope: Scope;
  ownerUserId: string | null;
  paidByUserId: string | null;
  status: ExpenseStatus;
  splits: ShareRow[];
}

export interface IncomeRow {
  id: string;
  payDate: string;
  grossAmount: string;
  netAmount: string;
  currency: Currency;
  kind: IncomeKind;
  sourceId: string;
  sourceName: string;
  sourceType: IncomeSourceType;
  scope: Scope;
  ownerUserId: string | null;
  deductions: { deductionTypeId: string; name: string; category: DeductionCategory; amount: string }[];
  splits: ShareRow[];
}

/**
 * Loads every expense of the household in the range. Reports expose only aggregates, so
 * personal records of other members are included regardless of the privacy mode.
 */
export const loadExpenses = async (db: DbOrTx, householdId: string, from: string, to: string): Promise<ExpenseRow[]> => {
  const rows = await db
    .select({
      id: expenses.id,
      date: expenses.date,
      amount: expenses.amount,
      currency: expenses.currency,
      categoryId: expenses.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      nature: expenses.nature,
      scope: expenses.scope,
      ownerUserId: expenses.ownerUserId,
      paidByUserId: expenses.paidByUserId,
      status: expenses.status,
    })
    .from(expenses)
    .leftJoin(categories, eq(categories.id, expenses.categoryId))
    .where(and(eq(expenses.householdId, householdId), gte(expenses.date, from), lte(expenses.date, to)));
  const sharedIds = rows.filter((r) => r.scope === 'shared').map((r) => r.id);
  const splits = sharedIds.length
    ? await db.select().from(expenseSplits).where(inArray(expenseSplits.expenseId, sharedIds))
    : [];
  return rows.map((r) => ({
    ...r,
    splits: splits
      .filter((s) => s.expenseId === r.id)
      .map((s) => ({ userId: s.userId, sharePct: Number(s.sharePct) })),
  }));
};

export const loadIncomes = async (db: DbOrTx, householdId: string, from: string, to: string): Promise<IncomeRow[]> => {
  const rows = await db
    .select({
      id: incomeEntries.id,
      payDate: incomeEntries.payDate,
      grossAmount: incomeEntries.grossAmount,
      netAmount: incomeEntries.netAmount,
      currency: incomeEntries.currency,
      kind: incomeEntries.kind,
      sourceId: incomeEntries.sourceId,
      sourceName: incomeSources.name,
      sourceType: incomeSources.type,
      scope: incomeSources.scope,
      ownerUserId: incomeSources.ownerUserId,
    })
    .from(incomeEntries)
    .innerJoin(incomeSources, eq(incomeSources.id, incomeEntries.sourceId))
    .where(
      and(eq(incomeEntries.householdId, householdId), gte(incomeEntries.payDate, from), lte(incomeEntries.payDate, to)),
    );
  const ids = rows.map((r) => r.id);
  const [deductions, splits] = ids.length
    ? await Promise.all([
        db
          .select({
            incomeEntryId: incomeDeductions.incomeEntryId,
            deductionTypeId: incomeDeductions.deductionTypeId,
            name: deductionTypes.name,
            category: deductionTypes.category,
            amount: incomeDeductions.amount,
          })
          .from(incomeDeductions)
          .innerJoin(deductionTypes, eq(deductionTypes.id, incomeDeductions.deductionTypeId))
          .where(inArray(incomeDeductions.incomeEntryId, ids)),
        db.select().from(incomeSplits).where(inArray(incomeSplits.incomeEntryId, ids)),
      ])
    : [[], []];
  return rows.map((r) => ({
    ...r,
    deductions: deductions
      .filter((d) => d.incomeEntryId === r.id)
      .map(({ incomeEntryId: _, ...d }) => d),
    splits: splits
      .filter((s) => s.incomeEntryId === r.id)
      .map((s) => ({ userId: s.userId, sharePct: Number(s.sharePct) })),
  }));
};
