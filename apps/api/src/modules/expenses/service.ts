import { splitByPct, type ReassignInput, type SplitInput } from '@mypersonalfinance/shared';
import { eq } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../../db/client';
import { expenses, expenseSplits } from '../../db/schema';
import { assertCanEdit, assertMembers, resolveSplits } from '../../lib/access';
import { writeAudit } from '../../lib/audit';
import type { AuthUser } from '../../plugins/auth';

type Expense = typeof expenses.$inferSelect;

/** Replaces the splits of an expense, computing exact share amounts. */
export const writeSplits = async (db: DbOrTx, expenseId: string, amount: string, splits: SplitInput[]) => {
  await db.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
  if (splits.length === 0) return [];
  const amounts = splitByPct(amount, splits.map((s) => s.sharePct));
  const rows = splits.map((s, i) => ({
    expenseId,
    userId: s.userId,
    sharePct: String(s.sharePct),
    shareAmount: amounts[i]!,
  }));
  await db.insert(expenseSplits).values(rows);
  return rows;
};

export const currentSplits = async (db: DbOrTx, expenseId: string): Promise<SplitInput[]> => {
  const rows = await db.select().from(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
  return rows.map((r) => ({ userId: r.userId, sharePct: Number(r.sharePct) }));
};

/**
 * Changes who an expense belongs to: person -> person, person -> household, household -> person.
 * `paidByUserId` never changes (who paid is a fact), so member balances recalculate on their own.
 */
export const reassignExpense = async (tx: Tx, user: AuthUser, expense: Expense, input: ReassignInput) => {
  assertCanEdit(user, expense.ownerUserId);
  const ownerUserId = input.scope === 'personal' ? input.ownerUserId! : null;
  await assertMembers(tx, user.householdId, [ownerUserId]);

  const beforeSplits = expense.scope === 'shared' ? await currentSplits(tx, expense.id) : [];
  const splits = input.scope === 'shared' ? await resolveSplits(tx, user.householdId, input.splits) : [];

  const [updated] = await tx
    .update(expenses)
    .set({ scope: input.scope, ownerUserId })
    .where(eq(expenses.id, expense.id))
    .returning();
  await writeSplits(tx, expense.id, expense.amount, splits);

  await writeAudit(tx, {
    householdId: user.householdId,
    userId: user.id,
    entity: 'expense',
    entityId: expense.id,
    action: 'reassign',
    before: { scope: expense.scope, ownerUserId: expense.ownerUserId, splits: beforeSplits },
    after: { scope: input.scope, ownerUserId, splits },
  });
  return { ...updated!, splits };
};
