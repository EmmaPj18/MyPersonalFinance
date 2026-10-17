import { and, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { households, incomeSources, recurringExpenses } from '../db/schema';
import { todayIn } from '../lib/dates';
import { generateScheduledIncome } from '../modules/income/service';
import { generateScheduledExpenses } from '../modules/recurring-expenses/service';

export interface RecurringRunOptions {
  householdId?: string;
  /** Overrides "today" (tests); otherwise each household's local date is used. */
  today?: string;
}

/**
 * Registers scheduled incomes and fixed expenses that came due. Safe to run any number of
 * times: each source/template remembers how far it was processed (`generatedThrough`) and
 * occurrences are unique per date.
 */
export const runRecurring = async (db: DbOrTx, options: RecurringRunOptions = {}) => {
  const rows = await db
    .select({ id: households.id, timezone: households.timezone })
    .from(households)
    .where(and(isNull(households.archivedAt), options.householdId ? eq(households.id, options.householdId) : undefined));
  let incomes = 0;
  let expenses = 0;
  for (const household of rows) {
    const today = options.today ?? todayIn(household.timezone);
    await db.transaction(async (tx) => {
      const sources = await tx.select().from(incomeSources).where(eq(incomeSources.householdId, household.id));
      for (const source of sources) incomes += await generateScheduledIncome(tx, source, today);
      const templates = await tx.select().from(recurringExpenses).where(eq(recurringExpenses.householdId, household.id));
      for (const template of templates) expenses += await generateScheduledExpenses(tx, template, today);
    });
  }
  return { incomes, expenses };
};
