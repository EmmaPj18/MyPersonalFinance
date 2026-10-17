export const APP_NAME = 'MyPersonalFinance';

export const CURRENCIES = ['DOP', 'USD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const USER_ROLES = ['owner', 'member', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** active = has a login; managed = member without an account, handled by the household. */
export const ACCOUNT_STATUSES = ['active', 'managed'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const PRIVACY_MODES = ['open', 'aggregated'] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];

export const SCOPES = ['personal', 'shared'] as const;
export type Scope = (typeof SCOPES)[number];

export const EXPENSE_NATURES = ['fixed', 'variable'] as const;
export type ExpenseNature = (typeof EXPENSE_NATURES)[number];

export const EXPENSE_STATUSES = ['pending', 'paid'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const INCOME_SOURCE_TYPES = [
  'formal_employment',
  'informal_employment',
  'freelance',
  'investment',
  'savings_interest',
  'rental',
  'other',
] as const;
export type IncomeSourceType = (typeof INCOME_SOURCE_TYPES)[number];

export const PAY_FREQUENCIES = [
  'weekly',
  'biweekly',
  'semimonthly',
  'monthly',
  'quarterly',
  'yearly',
  'irregular',
] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

export const INCOME_KINDS = [
  'salary',
  'bonus',
  'freelance',
  'investment_return',
  'interest',
  'dividend',
  'other',
] as const;
export type IncomeKind = (typeof INCOME_KINDS)[number];

export const DEDUCTION_CATEGORIES = [
  'income_tax',
  'social_security',
  'pension',
  'health',
  'loan',
  'union',
  'other',
] as const;
export type DeductionCategory = (typeof DEDUCTION_CATEGORIES)[number];

export const ACCOUNT_TYPES = ['bank', 'cash', 'credit_card', 'savings', 'investment'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const RECURRENCE_FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'yearly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** What to do when a scheduled date falls on a weekend. */
export const WEEKEND_RULES = ['none', 'previous', 'next'] as const;
export type WeekendRule = (typeof WEEKEND_RULES)[number];

/** Annual budget line kinds. */
export const BUDGET_LINE_KINDS = ['income', 'expense', 'saving'] as const;
export type BudgetLineKind = (typeof BUDGET_LINE_KINDS)[number];

/** Where market exchange rates come from. */
export const FX_SOURCES = ['bcrd', 'ecb', 'erapi', 'infodolar'] as const;
export type FxSource = (typeof FX_SOURCES)[number];
/** Sources a household can prefer for DOP rates. */
export const FX_PREFERRED_SOURCES = ['bcrd', 'infodolar'] as const;
export type FxPreferredSource = (typeof FX_PREFERRED_SOURCES)[number];
/** Which side of a quote to use: buy (compra), sell (venta) or their average. */
export const FX_SIDES = ['buy', 'sell', 'mid'] as const;
export type FxSide = (typeof FX_SIDES)[number];

/** Where a transaction waiting for review came from. */
export const INBOX_SOURCES = ['csv', 'xlsx', 'email'] as const;
export type InboxSource = (typeof INBOX_SOURCES)[number];
export const INBOX_STATUSES = ['pending', 'imported', 'ignored'] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];
/** What a reviewed transaction becomes. */
export const INBOX_KINDS = ['expense', 'income', 'transfer', 'ignore'] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];
export const DIRECTIONS = ['debit', 'credit'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DEBT_TYPES = ['loan', 'credit_card', 'mortgage', 'other'] as const;
export type DebtType = (typeof DEBT_TYPES)[number];
