import type { Currency, UserRole } from '@mypersonalfinance/shared';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Database, Tx } from '../../db/client';
import { householdMembershipHistory, households, users } from '../../db/schema';
import { writeAudit } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { seedHouseholdDefaults } from './seed';

export const createHousehold = async (tx: Tx, name: string, baseCurrency: Currency) => {
  const [household] = await tx.insert(households).values({ name, baseCurrency }).returning();
  await seedHouseholdDefaults(tx, household!.id);
  return household!;
};

export const openMembership = async (tx: Tx, userId: string, householdId: string, role: UserRole) => {
  await tx.insert(householdMembershipHistory).values({ userId, householdId, role });
};

const closeMembership = async (tx: Tx, userId: string, householdId: string) => {
  await tx
    .update(householdMembershipHistory)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(householdMembershipHistory.userId, userId),
        eq(householdMembershipHistory.householdId, householdId),
        isNull(householdMembershipHistory.leftAt),
      ),
    );
};

/** What would move with the user and what would stay, if they left their household now. */
export const leavePreview = async (db: Database | Tx, userId: string, householdId: string) => {
  const q = await db.execute<{ key: string; n: number }>(sql`
    select 'accounts' as key, count(*)::int as n from accounts where household_id = ${householdId} and owner_user_id = ${userId}
    union all select 'incomeSources', count(*)::int from income_sources where household_id = ${householdId} and scope = 'personal' and owner_user_id = ${userId}
    union all select 'incomeEntries', count(*)::int from income_entries e join income_sources s on s.id = e.source_id where e.household_id = ${householdId} and s.scope = 'personal' and s.owner_user_id = ${userId}
    union all select 'personalExpenses', count(*)::int from expenses where household_id = ${householdId} and scope = 'personal' and owner_user_id = ${userId}
    union all select 'recurringExpenses', count(*)::int from recurring_expenses where household_id = ${householdId} and scope = 'personal' and owner_user_id = ${userId}
    union all select 'savingsGoals', count(*)::int from savings_goals where household_id = ${householdId} and owner_user_id = ${userId}
    union all select 'debts', count(*)::int from debts where household_id = ${householdId} and owner_user_id = ${userId}
    union all select 'sharedExpensesStaying', count(*)::int from expenses where household_id = ${householdId} and scope = 'shared'
    union all select 'sharedIncomeSourcesStaying', count(*)::int from income_sources where household_id = ${householdId} and scope = 'shared'
  `);
  const counts: Record<string, number> = {};
  for (const row of q.rows) counts[row.key] = Number(row.n);
  return {
    moves: {
      accounts: counts.accounts ?? 0,
      incomeSources: counts.incomeSources ?? 0,
      incomeEntries: counts.incomeEntries ?? 0,
      personalExpenses: counts.personalExpenses ?? 0,
      recurringExpenses: counts.recurringExpenses ?? 0,
      savingsGoals: counts.savingsGoals ?? 0,
      debts: counts.debts ?? 0,
    },
    stays: {
      sharedExpenses: counts.sharedExpensesStaying ?? 0,
      sharedIncomeSources: counts.sharedIncomeSourcesStaying ?? 0,
    },
  };
};

/** Fails when the user is the last owner of a household that still has other members. */
export const assertCanLeave = async (tx: Database | Tx, userId: string, householdId: string, role: UserRole) => {
  if (role !== 'owner') return;
  const others = await tx
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.householdId, householdId), ne(users.id, userId)));
  if (others.length > 0 && !others.some((o) => o.role === 'owner')) {
    throw conflict('Eres el único dueño del hogar: transfiere la propiedad antes de salir', 'LAST_OWNER');
  }
};

/**
 * Moves a user to another household (or to a brand-new personal household when
 * `target` is null), taking their personal data with them. Shared data stays.
 */
export const moveUser = async (
  tx: Tx,
  userId: string,
  target: { householdId: string; role: UserRole } | null,
  actorId: string,
) => {
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
  if (!user) throw notFound('Usuario no encontrado');
  const from = user.householdId;
  if (target?.householdId === from) throw conflict('El usuario ya pertenece a ese hogar');
  await assertCanLeave(tx, userId, from, user.role);

  const destination =
    target ??
    ({ householdId: (await createHousehold(tx, `Hogar de ${user.name}`, user.defaultCurrency)).id, role: 'owner' } as const);
  const to = destination.householdId;
  const summary = await leavePreview(tx, userId, from);

  // 1. Move personal records.
  await tx.execute(sql`update accounts set household_id = ${to} where household_id = ${from} and owner_user_id = ${userId}`);
  await tx.execute(sql`
    with moved as (
      update income_sources set household_id = ${to}
      where household_id = ${from} and scope = 'personal' and owner_user_id = ${userId}
      returning id
    )
    update income_entries set household_id = ${to} where source_id in (select id from moved)`);
  await tx.execute(sql`
    update recurring_expenses set household_id = ${to}
    where household_id = ${from} and scope = 'personal' and owner_user_id = ${userId}`);
  await tx.execute(sql`
    update expenses set household_id = ${to}
    where household_id = ${from} and scope = 'personal' and owner_user_id = ${userId}`);
  await tx.execute(sql`update savings_goals set household_id = ${to} where household_id = ${from} and owner_user_id = ${userId}`);
  await tx.execute(sql`update debts set household_id = ${to} where household_id = ${from} and owner_user_id = ${userId}`);
  await moveBudgetItems(tx, userId, from, to);

  // 2. Remap catalogs (categories, deduction types) by name into the destination household.
  await remapCategories(tx, to);
  await remapDeductionTypes(tx, to);

  // 3. Break references that now cross households.
  for (const householdId of [from, to]) await detachForeignReferences(tx, householdId);

  // 4. Exchange rates: copy the old household's rates the destination doesn't have.
  await tx.execute(sql`
    insert into exchange_rates (household_id, date, from_currency, to_currency, rate)
    select ${to}, date, from_currency, to_currency, rate from exchange_rates where household_id = ${from}
    on conflict do nothing`);

  // 5. Membership.
  await tx.update(users).set({ householdId: to, role: destination.role, defaultSplitPct: null }).where(eq(users.id, userId));
  await closeMembership(tx, userId, from);
  await openMembership(tx, userId, to, destination.role);

  const [remaining] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.householdId, from));
  if (Number(remaining?.n ?? 0) === 0) {
    await tx.update(households).set({ archivedAt: new Date() }).where(eq(households.id, from));
  }

  for (const householdId of [from, to]) {
    await writeAudit(tx, {
      householdId,
      userId: actorId,
      entity: 'user',
      entityId: userId,
      action: householdId === from ? 'left_household' : 'joined_household',
      before: { householdId: from, role: user.role },
      after: { householdId: to, role: destination.role, moved: summary.moves },
    });
  }

  return { householdId: to, role: destination.role, moved: summary.moves };
};

const moveBudgetItems = async (tx: Tx, userId: string, from: string, to: string) => {
  // Make sure the destination has a budget for each month the user had personal items.
  await tx.execute(sql`
    insert into budgets (household_id, month, currency)
    select distinct ${to}::uuid, b.month, b.currency
    from budget_items i join budgets b on b.id = i.budget_id
    where b.household_id = ${from} and i.scope = 'personal' and i.owner_user_id = ${userId}
    on conflict do nothing`);
  // Only items whose destination budget uses the same currency can be moved without a conversion;
  // the rest are dropped (they are plans, not transactions).
  await tx.execute(sql`
    update budget_items i set budget_id = nb.id
    from budgets ob, budgets nb
    where ob.id = i.budget_id and ob.household_id = ${from}
      and nb.household_id = ${to} and nb.month = ob.month and nb.currency = ob.currency
      and i.scope = 'personal' and i.owner_user_id = ${userId}`);
  await tx.execute(sql`
    delete from budget_items i using budgets b
    where b.id = i.budget_id and b.household_id = ${from} and i.scope = 'personal' and i.owner_user_id = ${userId}`);
};

/** Points every category reference of `householdId` rows to a category of that same household. */
const remapCategories = async (tx: Tx, householdId: string) => {
  const foreign = sql`
    select category_id as id from expenses where household_id = ${householdId} and category_id is not null
    union select category_id from recurring_expenses where household_id = ${householdId} and category_id is not null
    union select i.category_id from budget_items i join budgets b on b.id = i.budget_id where b.household_id = ${householdId}`;
  // Create missing categories (matched by name, case-insensitive).
  await tx.execute(sql`
    insert into categories (household_id, name, color, icon, default_nature)
    select distinct on (lower(c.name)) ${householdId}::uuid, c.name, c.color, c.icon, c.default_nature
    from categories c where c.id in (${foreign}) and c.household_id <> ${householdId}
    on conflict do nothing`);
  const mapping = sql`
    select oc.id as old_id, nc.id as new_id from categories oc
    join categories nc on nc.household_id = ${householdId} and lower(nc.name) = lower(oc.name)
    where oc.household_id <> ${householdId}`;
  await tx.execute(sql`update expenses e set category_id = m.new_id from (${mapping}) m
    where e.household_id = ${householdId} and e.category_id = m.old_id`);
  await tx.execute(sql`update recurring_expenses e set category_id = m.new_id from (${mapping}) m
    where e.household_id = ${householdId} and e.category_id = m.old_id`);
  await tx.execute(sql`update budget_items i set category_id = m.new_id from (${mapping}) m, budgets b
    where b.id = i.budget_id and b.household_id = ${householdId} and i.category_id = m.old_id`);
};

const remapDeductionTypes = async (tx: Tx, householdId: string) => {
  const foreign = sql`
    select d.deduction_type_id as id from income_deductions d join income_entries e on e.id = d.income_entry_id where e.household_id = ${householdId}
    union select t.deduction_type_id from source_deduction_templates t join income_sources s on s.id = t.source_id where s.household_id = ${householdId}`;
  await tx.execute(sql`
    insert into deduction_types (household_id, name, category)
    select distinct on (lower(d.name)) ${householdId}::uuid, d.name, d.category
    from deduction_types d where d.id in (${foreign}) and d.household_id <> ${householdId}
    on conflict do nothing`);
  const mapping = sql`
    select od.id as old_id, nd.id as new_id from deduction_types od
    join deduction_types nd on nd.household_id = ${householdId} and lower(nd.name) = lower(od.name)
    where od.household_id <> ${householdId}`;
  await tx.execute(sql`update income_deductions d set deduction_type_id = m.new_id from (${mapping}) m, income_entries e
    where e.id = d.income_entry_id and e.household_id = ${householdId} and d.deduction_type_id = m.old_id`);
  await tx.execute(sql`update source_deduction_templates t set deduction_type_id = m.new_id from (${mapping}) m, income_sources s
    where s.id = t.source_id and s.household_id = ${householdId} and t.deduction_type_id = m.old_id`);
};

/** Nulls out optional references from `householdId` rows to records of another household. */
const detachForeignReferences = async (tx: Tx, householdId: string) => {
  const ownAccounts = sql`(select id from accounts where household_id = ${householdId})`;
  for (const table of ['income_sources', 'income_entries', 'expenses', 'recurring_expenses', 'savings_goals']) {
    await tx.execute(sql`
      update ${sql.identifier(table)} set account_id = null
      where household_id = ${householdId} and account_id is not null and account_id not in ${ownAccounts}`);
  }
  await tx.execute(sql`
    update expenses set recurring_expense_id = null
    where household_id = ${householdId} and recurring_expense_id is not null
      and recurring_expense_id not in (select id from recurring_expenses where household_id = ${householdId})`);
  await tx.execute(sql`
    update debt_payments p set expense_id = null
    from debts d, expenses e
    where d.id = p.debt_id and e.id = p.expense_id and d.household_id = ${householdId} and e.household_id <> ${householdId}`);
};
