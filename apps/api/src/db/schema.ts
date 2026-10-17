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
  ACCOUNT_TYPES,
  CURRENCIES,
  DEBT_TYPES,
  DEDUCTION_CATEGORIES,
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
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    email: varchar('email', { length: 254 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
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
    sourceId: uuid('source_id')
      .notNull()
      .references(() => incomeSources.id, { onDelete: 'cascade' }),
    deductionTypeId: uuid('deduction_type_id')
      .notNull()
      .references(() => deductionTypes.id, { onDelete: 'cascade' }),
    defaultAmount: money('default_amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.deductionTypeId] })],
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

export const budgets = pgTable(
  'budgets',
  {
    id: id(),
    householdId: householdRef(),
    /** First day of the month. */
    month: date('month').notNull(),
    currency: currencyEnum('currency').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('budgets_household_month_uq').on(t.householdId, t.month)],
);

export const budgetItems = pgTable(
  'budget_items',
  {
    id: id(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    scope: scopeEnum('scope').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    plannedAmount: money('planned_amount').notNull(),
  },
  (t) => [
    uniqueIndex('budget_items_uq').on(
      t.budgetId,
      t.categoryId,
      t.scope,
      sql`coalesce(${t.ownerUserId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    ownerScopeCheck('budget_items_owner_scope', t.scope, t.ownerUserId),
  ],
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
