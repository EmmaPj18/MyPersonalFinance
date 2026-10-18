import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  BUDGET_LINE_KINDS,
  CURRENCIES,
  DEBT_TYPES,
  DEDUCTION_CATEGORIES,
  DIRECTIONS,
  INBOX_KINDS,
  INBOX_SOURCES,
  INBOX_STATUSES,
  FX_PREFERRED_SOURCES,
  FX_SIDES,
  FX_SOURCES,
  EXPENSE_NATURES,
  EXPENSE_STATUSES,
  INCOME_KINDS,
  INCOME_SOURCE_TYPES,
  PAY_FREQUENCIES,
  PRIVACY_MODES,
  RECURRENCE_FREQUENCIES,
  SCOPES,
  USER_ROLES,
  WEEKEND_RULES,
} from '@mypersonalfinance/shared';

export const currencyEnum = pgEnum('currency', CURRENCIES);
export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const accountStatusEnum = pgEnum('account_status', ACCOUNT_STATUSES);
export const privacyModeEnum = pgEnum('privacy_mode', PRIVACY_MODES);
export const scopeEnum = pgEnum('scope', SCOPES);
export const expenseNatureEnum = pgEnum('expense_nature', EXPENSE_NATURES);
export const expenseStatusEnum = pgEnum('expense_status', EXPENSE_STATUSES);
export const incomeSourceTypeEnum = pgEnum('income_source_type', INCOME_SOURCE_TYPES);
export const payFrequencyEnum = pgEnum('pay_frequency', PAY_FREQUENCIES);
export const incomeKindEnum = pgEnum('income_kind', INCOME_KINDS);
export const deductionCategoryEnum = pgEnum('deduction_category', DEDUCTION_CATEGORIES);
export const accountTypeEnum = pgEnum('account_type', ACCOUNT_TYPES);
export const recurrenceFrequencyEnum = pgEnum('recurrence_frequency', RECURRENCE_FREQUENCIES);
export const debtTypeEnum = pgEnum('debt_type', DEBT_TYPES);
export const weekendRuleEnum = pgEnum('weekend_rule', WEEKEND_RULES);
export const budgetLineKindEnum = pgEnum('budget_line_kind', BUDGET_LINE_KINDS);
export const fxSourceEnum = pgEnum('fx_source', FX_SOURCES);
export const fxPreferredSourceEnum = pgEnum('fx_preferred_source', FX_PREFERRED_SOURCES);
export const fxSideEnum = pgEnum('fx_side', FX_SIDES);
export const inboxSourceEnum = pgEnum('inbox_source', INBOX_SOURCES);
export const inboxStatusEnum = pgEnum('inbox_status', INBOX_STATUSES);
export const inboxKindEnum = pgEnum('inbox_kind', INBOX_KINDS);
export const directionEnum = pgEnum('direction', DIRECTIONS);

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const pct = (name: string) => numeric(name, { precision: 5, scale: 2 });
const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const householdRef = () =>
  uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' });

/** personal => owner required; shared => no owner. */
const ownerScopeCheck = (name: string, scope: unknown, owner: unknown) =>
  check(
    name,
    sql`(${scope} = 'personal' AND ${owner} IS NOT NULL) OR (${scope} = 'shared' AND ${owner} IS NULL)`,
  );

// ---------------------------------------------------------------- identity

export const households = pgTable('households', {
  id: id(),
  name: varchar('name', { length: 120 }).notNull(),
  baseCurrency: currencyEnum('base_currency').notNull().default('DOP'),
  privacyMode: privacyModeEnum('privacy_mode').notNull().default('open'),
  /** IANA time zone used to decide "today" for scheduled incomes and expenses. */
  timezone: varchar('timezone', { length: 64 }).notNull().default('America/Santo_Domingo'),
  /** Market rates used for DOP conversions: official (BCRD) or a specific entity via Infodolar. */
  fxSource: fxPreferredSourceEnum('fx_source').notNull().default('bcrd'),
  /** Infodolar entity name when fxSource = infodolar (e.g. "Banreservas"). */
  fxEntity: varchar('fx_entity', { length: 120 }),
  fxSide: fxSideEnum('fx_side').notNull().default('mid'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Null for members without an account (managed). */
    email: varchar('email', { length: 254 }),
    passwordHash: text('password_hash'),
    name: varchar('name', { length: 120 }).notNull(),
    accountStatus: accountStatusEnum('account_status').notNull().default('active'),
    defaultCurrency: currencyEnum('default_currency').notNull().default('DOP'),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    role: userRoleEnum('role').notNull().default('owner'),
    /** Default share of shared expenses/incomes. Null = equal split among members. */
    defaultSplitPct: pct('default_split_pct'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`), index('users_household_idx').on(t.householdId)],
);

export const sessions = pgTable('sessions', {
  /** sha256 of the opaque token stored in the cookie. */
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const householdMembershipHistory = pgTable(
  'household_membership_history',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    householdId: householdRef(),
    role: userRoleEnum('role').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [index('membership_household_idx').on(t.householdId), index('membership_user_idx').on(t.userId)],
);

export const householdInvitations = pgTable(
  'household_invitations',
  {
    id: id(),
    householdId: householdRef(),
    email: varchar('email', { length: 254 }).notNull(),
    role: userRoleEnum('role').notNull().default('member'),
    /** sha256 of the invitation token. */
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    /** Managed member whose account the invitee takes over. */
    memberId: uuid('member_id').references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invitations_token_uq').on(t.tokenHash), index('invitations_household_idx').on(t.householdId)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    householdId: householdRef(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    entity: varchar('entity', { length: 60 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    action: varchar('action', { length: 40 }).notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_entity_idx').on(t.householdId, t.entity, t.entityId)],
);

// ---------------------------------------------------------------- catalogs

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    householdId: householdRef(),
    /** Null = shared account of the household. */
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    name: varchar('name', { length: 120 }).notNull(),
    type: accountTypeEnum('type').notNull(),
    currency: currencyEnum('currency').notNull(),
    openingBalance: money('opening_balance').notNull().default('0'),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('accounts_household_idx').on(t.householdId)],
);

export const categories = pgTable(
  'categories',
  {
    id: id(),
    householdId: householdRef(),
    parentId: uuid('parent_id'),
    name: varchar('name', { length: 80 }).notNull(),
    color: varchar('color', { length: 16 }),
    icon: varchar('icon', { length: 40 }),
    defaultNature: expenseNatureEnum('default_nature').notNull().default('variable'),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('categories_household_name_uq').on(t.householdId, sql`lower(${t.name})`)],
);

export const deductionTypes = pgTable(
  'deduction_types',
  {
    id: id(),
    householdId: householdRef(),
    name: varchar('name', { length: 80 }).notNull(),
    category: deductionCategoryEnum('category').notNull(),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('deduction_types_household_name_uq').on(t.householdId, sql`lower(${t.name})`)],
);

export const exchangeRates = pgTable(
  'exchange_rates',
  {
    householdId: householdRef(),
    date: date('date').notNull(),
    fromCurrency: currencyEnum('from_currency').notNull(),
    toCurrency: currencyEnum('to_currency').notNull(),
    rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.date, t.fromCurrency, t.toCurrency] }),
    check('exchange_rates_positive', sql`${t.rate} > 0`),
  ],
);

/**
 * Exchange rates fetched from public sources, shared by every household.
 * `entity` is the bank or exchange house for sources that quote several (Infodolar), '' otherwise.
 */
export const marketRates = pgTable(
  'market_rates',
  {
    source: fxSourceEnum('source').notNull(),
    entity: varchar('entity', { length: 120 }).notNull().default(''),
    date: date('date').notNull(),
    fromCurrency: currencyEnum('from_currency').notNull(),
    toCurrency: currencyEnum('to_currency').notNull(),
    buy: numeric('buy', { precision: 18, scale: 8 }),
    sell: numeric('sell', { precision: 18, scale: 8 }),
    mid: numeric('mid', { precision: 18, scale: 8 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.entity, t.date, t.fromCurrency, t.toCurrency] }),
    check('market_rates_positive', sql`${t.mid} > 0`),
  ],
);

// ---------------------------------------------------------------- income

export const incomeSources = pgTable(
  'income_sources',
  {
    id: id(),
    householdId: householdRef(),
    scope: scopeEnum('scope').notNull().default('personal'),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    name: varchar('name', { length: 120 }).notNull(),
    type: incomeSourceTypeEnum('type').notNull(),
    defaultCurrency: currencyEnum('default_currency').notNull(),
    payFrequency: payFrequencyEnum('pay_frequency').notNull().default('monthly'),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    // ---- Pay schedule (see packages/shared/src/recurrence.ts)
    /** Day of the month it's paid (monthly/semimonthly/quarterly/yearly). */
    payDay: integer('pay_day'),
    /** Second pay day for semimonthly sources. */
    secondPayDay: integer('second_pay_day'),
    /** First pay date; weekly/biweekly schedules step from it. */
    scheduleStartDate: date('schedule_start_date'),
    weekendRule: weekendRuleEnum('weekend_rule').notNull().default('none'),
    expectedGross: money('expected_gross'),
    /** Register each payment automatically on its pay day. */
    autoRegister: boolean('auto_register').notNull().default(false),
    /** Last date already processed by the scheduler (payments up to it exist or were skipped). */
    generatedThrough: date('generated_through'),
    createdAt: createdAt(),
  },
  (t) => [
    index('income_sources_household_idx').on(t.householdId),
    ownerScopeCheck('income_sources_owner_scope', t.scope, t.ownerUserId),
  ],
);

export const sourceDeductionTemplates = pgTable(
  'source_deduction_templates',
  {
    id: id(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => incomeSources.id, { onDelete: 'cascade' }),
    deductionTypeId: uuid('deduction_type_id')
      .notNull()
      .references(() => deductionTypes.id, { onDelete: 'cascade' }),
    defaultAmount: money('default_amount').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  // The same deduction type can appear twice (e.g. complementary insurance for two people).
  (t) => [index('source_deduction_templates_source_idx').on(t.sourceId)],
);

export const incomeEntries = pgTable(
  'income_entries',
  {
    id: id(),
    householdId: householdRef(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => incomeSources.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    kind: incomeKindEnum('kind').notNull(),
    payDate: date('pay_date').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    grossAmount: money('gross_amount').notNull(),
    netAmount: money('net_amount').notNull(),
    currency: currencyEnum('currency').notNull(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    notes: text('notes'),
    /** Pay date of the schedule that generated it (null for manual entries). */
    scheduledDate: date('scheduled_date'),
    autoGenerated: boolean('auto_generated').notNull().default(false),
    /** Amounts come from the source's template and haven't been confirmed yet. */
    isEstimated: boolean('is_estimated').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('income_entries_household_date_idx').on(t.householdId, t.payDate),
    index('income_entries_source_idx').on(t.sourceId),
    uniqueIndex('income_entries_scheduled_uq').on(t.sourceId, t.scheduledDate),
    check('income_entries_net_non_negative', sql`${t.netAmount} >= 0`),
  ],
);

export const incomeDeductions = pgTable('income_deductions', {
  id: id(),
  incomeEntryId: uuid('income_entry_id')
    .notNull()
    .references(() => incomeEntries.id, { onDelete: 'cascade' }),
  deductionTypeId: uuid('deduction_type_id')
    .notNull()
    .references(() => deductionTypes.id),
  amount: money('amount').notNull(),
});

export const incomeSplits = pgTable(
  'income_splits',
  {
    incomeEntryId: uuid('income_entry_id')
      .notNull()
      .references(() => incomeEntries.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sharePct: pct('share_pct').notNull(),
  },
  (t) => [primaryKey({ columns: [t.incomeEntryId, t.userId] })],
);

// ---------------------------------------------------------------- expenses

export const recurringExpenses = pgTable(
  'recurring_expenses',
  {
    id: id(),
    householdId: householdRef(),
    name: varchar('name', { length: 120 }).notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    amount: money('amount').notNull(),
    currency: currencyEnum('currency').notNull(),
    scope: scopeEnum('scope').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    frequency: recurrenceFrequencyEnum('frequency').notNull().default('monthly'),
    dueDay: integer('due_day').notNull().default(1),
    /** Second due day for semimonthly expenses. */
    secondDueDay: integer('second_due_day'),
    weekendRule: weekendRuleEnum('weekend_rule').notNull().default('none'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    isVariableAmount: boolean('is_variable_amount').notNull().default(false),
    active: boolean('active').notNull().default(true),
    /** Register each occurrence as paid on its due date (otherwise it's created pending). */
    autoPay: boolean('auto_pay').notNull().default(true),
    /** Member who usually pays it (defaults to the owner, or whoever created it). */
    paidByUserId: uuid('paid_by_user_id').references(() => users.id),
    /** Last date already processed by the scheduler. */
    generatedThrough: date('generated_through'),
    createdAt: createdAt(),
  },
  (t) => [
    index('recurring_expenses_household_idx').on(t.householdId),
    ownerScopeCheck('recurring_owner_scope', t.scope, t.ownerUserId),
    check('recurring_due_day', sql`${t.dueDay} BETWEEN 1 AND 31`),
  ],
);

export const recurringExpenseSplits = pgTable(
  'recurring_expense_splits',
  {
    recurringExpenseId: uuid('recurring_expense_id')
      .notNull()
      .references(() => recurringExpenses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sharePct: pct('share_pct').notNull(),
  },
  (t) => [primaryKey({ columns: [t.recurringExpenseId, t.userId] })],
);

export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    householdId: householdRef(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    paidByUserId: uuid('paid_by_user_id').references(() => users.id),
    amount: money('amount').notNull(),
    currency: currencyEnum('currency').notNull(),
    date: date('date').notNull(),
    description: varchar('description', { length: 255 }).notNull(),
    nature: expenseNatureEnum('nature').notNull().default('variable'),
    scope: scopeEnum('scope').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    recurringExpenseId: uuid('recurring_expense_id').references(() => recurringExpenses.id, {
      onDelete: 'set null',
    }),
    status: expenseStatusEnum('status').notNull().default('paid'),
    autoGenerated: boolean('auto_generated').notNull().default(false),
    /** Amount is the template's estimate (variable fixed expenses) and hasn't been confirmed. */
    isEstimated: boolean('is_estimated').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('expenses_household_date_idx').on(t.householdId, t.date),
    // A recurring template generates at most one occurrence per date.
    uniqueIndex('expenses_recurring_occurrence_uq').on(t.recurringExpenseId, t.date),
    ownerScopeCheck('expenses_owner_scope', t.scope, t.ownerUserId),
    check('expenses_amount_positive', sql`${t.amount} > 0`),
  ],
);

export const expenseSplits = pgTable(
  'expense_splits',
  {
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sharePct: pct('share_pct').notNull(),
    shareAmount: money('share_amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.userId] })],
);

// ---------------------------------------------------------------- budgets

/** Annual budget of a household. */
export const budgetPlans = pgTable(
  'budget_plans',
  {
    id: id(),
    householdId: householdRef(),
    year: integer('year').notNull(),
    currency: currencyEnum('currency').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('budget_plans_household_year_uq').on(t.householdId, t.year)],
);

/** One row of the annual budget: an income source, an expense category or a savings goal. */
export const budgetLines = pgTable(
  'budget_lines',
  {
    id: id(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => budgetPlans.id, { onDelete: 'cascade' }),
    kind: budgetLineKindEnum('kind').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    incomeSourceId: uuid('income_source_id').references(() => incomeSources.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').references(() => savingsGoals.id, { onDelete: 'cascade' }),
    scope: scopeEnum('scope').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    /** Expense lines: fixed or variable (groups the grid). */
    nature: expenseNatureEnum('nature'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('budget_lines_plan_idx').on(t.planId),
    ownerScopeCheck('budget_lines_owner_scope', t.scope, t.ownerUserId),
    check(
      'budget_lines_target',
      sql`(${t.kind} = 'expense' AND ${t.categoryId} IS NOT NULL) OR (${t.kind} = 'income' AND ${t.incomeSourceId} IS NOT NULL) OR (${t.kind} = 'saving' AND ${t.goalId} IS NOT NULL)`,
    ),
  ],
);

/** Planned amount of a line for one month (1–12), in the plan's currency. */
export const budgetLineAmounts = pgTable(
  'budget_line_amounts',
  {
    lineId: uuid('line_id')
      .notNull()
      .references(() => budgetLines.id, { onDelete: 'cascade' }),
    month: integer('month').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.lineId, t.month] }), check('budget_line_amounts_month', sql`${t.month} BETWEEN 1 AND 12`)],
);

// ---------------------------------------------------------------- goals & debts

export const savingsGoals = pgTable(
  'savings_goals',
  {
    id: id(),
    householdId: householdRef(),
    /** Null = shared goal. */
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    name: varchar('name', { length: 120 }).notNull(),
    targetAmount: money('target_amount').notNull(),
    currency: currencyEnum('currency').notNull(),
    targetDate: date('target_date'),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('savings_goals_household_idx').on(t.householdId)],
);

export const goalContributions = pgTable('goal_contributions', {
  id: id(),
  goalId: uuid('goal_id')
    .notNull()
    .references(() => savingsGoals.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  /** Same currency as the goal. */
  amount: money('amount').notNull(),
  date: date('date').notNull(),
  createdAt: createdAt(),
});

export const debts = pgTable(
  'debts',
  {
    id: id(),
    householdId: householdRef(),
    /** Null = shared debt. */
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    name: varchar('name', { length: 120 }).notNull(),
    type: debtTypeEnum('type').notNull(),
    originalAmount: money('original_amount').notNull(),
    currency: currencyEnum('currency').notNull(),
    /** Annual percentage, e.g. 18.5 */
    interestRate: numeric('interest_rate', { precision: 7, scale: 4 }),
    minPayment: money('min_payment'),
    dueDay: integer('due_day'),
    startDate: date('start_date').notNull(),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('debts_household_idx').on(t.householdId)],
);

export const debtPayments = pgTable('debt_payments', {
  id: id(),
  debtId: uuid('debt_id')
    .notNull()
    .references(() => debts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  date: date('date').notNull(),
  /** Same currency as the debt. */
  amount: money('amount').notNull(),
  principalPortion: money('principal_portion').notNull(),
  interestPortion: money('interest_portion').notNull().default('0'),
  expenseId: uuid('expense_id').references(() => expenses.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- transfers, import and review

/** Money moved between two accounts of the household (not an expense). */
export const accountTransfers = pgTable(
  'account_transfers',
  {
    id: id(),
    householdId: householdRef(),
    fromAccountId: uuid('from_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    toAccountId: uuid('to_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    /** In `currency` (the origin account's). */
    amount: money('amount').notNull(),
    currency: currencyEnum('currency').notNull(),
    /** Amount credited in the destination account's currency, when it differs. */
    toAmount: money('to_amount'),
    description: varchar('description', { length: 255 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('account_transfers_household_idx').on(t.householdId, t.date),
    check('account_transfers_distinct', sql`${t.fromAccountId} <> ${t.toAccountId}`),
    check('account_transfers_positive', sql`${t.amount} > 0`),
  ],
);

export const importBatches = pgTable('import_batches', {
  id: id(),
  householdId: householdRef(),
  source: inboxSourceEnum('source').notNull(),
  fileName: varchar('file_name', { length: 255 }),
  rowCount: integer('row_count').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

/** Saved column mapping for a bank's export format. */
export const importProfiles = pgTable(
  'import_profiles',
  {
    id: id(),
    householdId: householdRef(),
    name: varchar('name', { length: 120 }).notNull(),
    mapping: jsonb('mapping').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('import_profiles_household_name_uq').on(t.householdId, sql`lower(${t.name})`)],
);

/** "When the description contains X, it's Y": suggestions for transactions under review. */
export const categorizationRules = pgTable(
  'categorization_rules',
  {
    id: id(),
    householdId: householdRef(),
    /** Normalized text (lowercase, no accents) the description must contain. */
    pattern: varchar('pattern', { length: 255 }).notNull(),
    kind: inboxKindEnum('kind').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    incomeSourceId: uuid('income_source_id').references(() => incomeSources.id, { onDelete: 'cascade' }),
    transferAccountId: uuid('transfer_account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    scope: scopeEnum('scope').notNull().default('shared'),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('categorization_rules_household_pattern_uq').on(t.householdId, t.pattern)],
);

/** Transactions imported from files or emails, waiting to be reviewed. */
export const transactionInbox = pgTable(
  'transaction_inbox',
  {
    id: id(),
    householdId: householdRef(),
    source: inboxSourceEnum('source').notNull(),
    batchId: uuid('batch_id').references(() => importBatches.id, { onDelete: 'set null' }),
    /** Row number, email message id... */
    externalRef: varchar('external_ref', { length: 255 }),
    /** Same transaction imported twice is skipped. */
    dedupeHash: varchar('dedupe_hash', { length: 64 }).notNull(),
    date: date('date').notNull(),
    description: varchar('description', { length: 255 }).notNull(),
    amount: money('amount').notNull(),
    currency: currencyEnum('currency').notNull(),
    direction: directionEnum('direction').notNull(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    // Classification (suggested by rules, edited during review)
    kind: inboxKindEnum('kind').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    incomeSourceId: uuid('income_source_id').references(() => incomeSources.id, { onDelete: 'set null' }),
    transferAccountId: uuid('transfer_account_id').references(() => accounts.id, { onDelete: 'set null' }),
    scope: scopeEnum('scope').notNull().default('shared'),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    ruleId: uuid('rule_id').references(() => categorizationRules.id, { onDelete: 'set null' }),
    /** Existing expense that looks like the same transaction. */
    duplicateOfExpenseId: uuid('duplicate_of_expense_id').references(() => expenses.id, { onDelete: 'set null' }),
    raw: jsonb('raw'),
    status: inboxStatusEnum('status').notNull().default('pending'),
    expenseId: uuid('expense_id').references(() => expenses.id, { onDelete: 'set null' }),
    incomeEntryId: uuid('income_entry_id').references(() => incomeEntries.id, { onDelete: 'set null' }),
    transferId: uuid('transfer_id').references(() => accountTransfers.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('transaction_inbox_dedupe_uq').on(t.householdId, t.dedupeHash),
    index('transaction_inbox_status_idx').on(t.householdId, t.status, t.date),
    check('transaction_inbox_amount_positive', sql`${t.amount} > 0`),
  ],
);
