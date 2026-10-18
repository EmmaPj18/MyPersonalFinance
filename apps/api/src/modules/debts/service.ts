import Decimal from 'decimal.js';
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { debtPayments, debts, expenses } from '../../db/schema';

type Expense = typeof expenses.$inferSelect;

/** Outstanding principal of a debt: original amount minus the principal paid so far. */
export const debtBalance = async (db: DbOrTx, debtId: string) => {
  const [debt] = await db.select().from(debts).where(eq(debts.id, debtId));
  if (!debt) return null;
  const [paid] = await db
    .select({ total: sql<string>`coalesce(sum(${debtPayments.principalPortion}), 0)` })
    .from(debtPayments)
    .where(eq(debtPayments.debtId, debtId));
  return { debt, balance: Decimal.max(0, new Decimal(debt.originalAmount).minus(paid?.total ?? 0)) };
};

/**
 * Splits a loan installment into interest and principal: one month of interest on the
 * outstanding balance (annual rate / 12), the rest goes to principal.
 */
export const splitInstallment = (amount: Decimal.Value, balance: Decimal.Value, annualRatePct: Decimal.Value | null) => {
  const total = new Decimal(amount);
  const interest = Decimal.min(total, new Decimal(balance).times(annualRatePct ?? 0).div(1200)).toDecimalPlaces(2);
  return { interest: interest.toFixed(2), principal: total.minus(interest).toFixed(2) };
};

/**
 * Registers (or updates) the debt payment of a paid expense that belongs to a loan.
 * Only same-currency installments are recorded; other currencies are skipped.
 */
export const syncDebtPayment = async (db: DbOrTx, debtId: string, expense: Expense) => {
  if (expense.status !== 'paid') return null;
  const state = await debtBalance(db, debtId);
  if (!state || state.debt.currency !== expense.currency) return null;
  const [existing] = await db.select().from(debtPayments).where(eq(debtPayments.expenseId, expense.id));
  // The balance before this payment (if it was already counted, add its principal back).
  const before = existing ? state.balance.plus(existing.principalPortion) : state.balance;
  const { interest, principal } = splitInstallment(expense.amount, before, state.debt.interestRate);
  const values = {
    debtId,
    userId: expense.paidByUserId,
    date: expense.date,
    amount: expense.amount,
    interestPortion: interest,
    principalPortion: principal,
    expenseId: expense.id,
  };
  if (existing) {
    const [row] = await db.update(debtPayments).set(values).where(eq(debtPayments.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(debtPayments).values(values).returning();
  return row;
};
