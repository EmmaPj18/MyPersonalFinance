import { z } from 'zod';
import {
  ACCOUNT_TYPES,
  BUDGET_LINE_KINDS,
  DEBT_TYPES,
  DEDUCTION_CATEGORIES,
  EXPENSE_NATURES,
  EXPENSE_STATUSES,
  INBOX_KINDS,
  RULE_KINDS,
  INCOME_KINDS,
  INCOME_SOURCE_TYPES,
  PAY_FREQUENCIES,
  RECURRENCE_FREQUENCIES,
  WEEKEND_RULES,
} from '../constants';
import {
  currencySchema,
  isoDateSchema,
  moneySchema,
  monthSchema,
  scopeSchema,
  splitInputSchema,
  uuidSchema,
} from './common';

const optionalId = uuidSchema.nullable().optional();
const nameField = z.string().trim().min(1).max(120);
const dayOfMonthSchema = z.coerce.number().int().min(1).max(31);

// ---------------------------------------------------------------- catalogs

export const accountInputSchema = z.object({
  name: nameField,
  type: z.enum(ACCOUNT_TYPES),
  currency: currencySchema,
  /** Null = shared account. */
  ownerUserId: optionalId,
  openingBalance: moneySchema.default('0'),
  /** Last digits of its cards/account numbers, comma separated, to match bank emails. */
  identifiers: z.string().trim().max(120).nullable().optional(),
  archived: z.boolean().optional(),
});
export type AccountInput = z.input<typeof accountInputSchema>;

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: optionalId,
  color: z.string().max(16).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  defaultNature: z.enum(EXPENSE_NATURES).default('variable'),
  archived: z.boolean().optional(),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;

export const deductionTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(DEDUCTION_CATEGORIES),
  archived: z.boolean().optional(),
});
export type DeductionTypeInput = z.input<typeof deductionTypeInputSchema>;

export const fxRateInputSchema = z
  .object({
    date: isoDateSchema,
    fromCurrency: currencySchema,
    toCurrency: currencySchema,
    rate: z.coerce.number().positive(),
  })
  .refine((v) => v.fromCurrency !== v.toCurrency, { message: 'Las monedas deben ser distintas', path: ['toCurrency'] });
export type FxRateInput = z.input<typeof fxRateInputSchema>;

// ---------------------------------------------------------------- income

const splitsField = z.array(splitInputSchema).optional();

export const incomeSourceInputSchema = z.object({
  name: nameField,
  type: z.enum(INCOME_SOURCE_TYPES),
  scope: scopeSchema.default('personal'),
  /** Required when personal; defaults to the current user. */
  ownerUserId: optionalId,
  defaultCurrency: currencySchema,
  payFrequency: z.enum(PAY_FREQUENCIES).default('monthly'),
  accountId: optionalId,
  isActive: z.boolean().optional(),
  deductionTemplates: z
    .array(z.object({ deductionTypeId: uuidSchema, defaultAmount: moneySchema }))
    .optional(),
  // Pay schedule
  payDay: dayOfMonthSchema.nullable().optional(),
  secondPayDay: dayOfMonthSchema.nullable().optional(),
  scheduleStartDate: isoDateSchema.nullable().optional(),
  weekendRule: z.enum(WEEKEND_RULES).default('none'),
  expectedGross: moneySchema.nullable().optional(),
  /** Register each payment automatically on its pay day (needs schedule, expected gross and account). */
  autoRegister: z.boolean().default(false),
});
export type IncomeSourceInput = z.input<typeof incomeSourceInputSchema>;

export const incomeEntryInputSchema = z.object({
  sourceId: uuidSchema,
  kind: z.enum(INCOME_KINDS),
  payDate: isoDateSchema,
  periodStart: isoDateSchema.nullable().optional(),
  periodEnd: isoDateSchema.nullable().optional(),
  grossAmount: moneySchema,
  currency: currencySchema,
  accountId: optionalId,
  notes: z.string().max(1000).nullable().optional(),
  deductions: z.array(z.object({ deductionTypeId: uuidSchema, amount: moneySchema })).default([]),
  /** Only for shared sources: attribution per member. */
  splits: splitsField,
});
export type IncomeEntryInput = z.input<typeof incomeEntryInputSchema>;

export const incomeEntryFiltersSchema = z.object({
  month: monthSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  sourceId: uuidSchema.optional(),
  ownerUserId: uuidSchema.optional(),
  scope: scopeSchema.optional(),
  kind: z.enum(INCOME_KINDS).optional(),
});

// ---------------------------------------------------------------- expenses

export const expenseInputSchema = z.object({
  description: z.string().trim().min(1).max(255),
  amount: moneySchema,
  currency: currencySchema,
  date: isoDateSchema,
  categoryId: optionalId,
  accountId: optionalId,
  /** Defaults to the current user. */
  paidByUserId: optionalId,
  nature: z.enum(EXPENSE_NATURES).default('variable'),
  scope: scopeSchema,
  /** Required when personal; defaults to the current user. */
  ownerUserId: optionalId,
  status: z.enum(EXPENSE_STATUSES).default('paid'),
  /** Only for shared expenses. Defaults to the members' default split. */
  splits: splitsField,
});
export type ExpenseInput = z.input<typeof expenseInputSchema>;

export const expenseFiltersSchema = z.object({
  month: monthSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  categoryId: uuidSchema.optional(),
  accountId: uuidSchema.optional(),
  ownerUserId: uuidSchema.optional(),
  paidByUserId: uuidSchema.optional(),
  nature: z.enum(EXPENSE_NATURES).optional(),
  scope: scopeSchema.optional(),
  status: z.enum(EXPENSE_STATUSES).optional(),
});

export const reassignInputSchema = z
  .object({
    scope: scopeSchema,
    ownerUserId: optionalId,
    splits: splitsField,
  })
  .refine((v) => v.scope === 'shared' || Boolean(v.ownerUserId), {
    message: 'Un gasto personal necesita dueño',
    path: ['ownerUserId'],
  });
export type ReassignInput = z.infer<typeof reassignInputSchema>;

export const payExpenseInputSchema = z.object({
  amount: moneySchema.optional(),
  date: isoDateSchema.optional(),
  accountId: optionalId,
  paidByUserId: optionalId,
});

export const recurringExpenseInputSchema = z.object({
  name: nameField,
  categoryId: optionalId,
  accountId: optionalId,
  amount: moneySchema,
  currency: currencySchema,
  scope: scopeSchema,
  ownerUserId: optionalId,
  splits: splitsField,
  frequency: z.enum(RECURRENCE_FREQUENCIES).default('monthly'),
  dueDay: dayOfMonthSchema.default(1),
  secondDueDay: dayOfMonthSchema.nullable().optional(),
  weekendRule: z.enum(WEEKEND_RULES).default('none'),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable().optional(),
  isVariableAmount: z.boolean().default(false),
  active: z.boolean().default(true),
  /** Register as paid on the due date (otherwise it's created pending). */
  autoPay: z.boolean().default(true),
  /** Who usually pays it; defaults to the current user. */
  paidByUserId: optionalId,
  /** Existing expense that becomes the first occurrence ("convert to fixed"). */
  linkExpenseId: optionalId,
});
export type RecurringExpenseInput = z.input<typeof recurringExpenseInputSchema>;

// ---------------------------------------------------------------- budgets

export const budgetLineInputSchema = z.object({
  kind: z.enum(BUDGET_LINE_KINDS),
  /** expense lines */
  categoryId: optionalId,
  /** income lines */
  incomeSourceId: optionalId,
  /** saving lines */
  goalId: optionalId,
  scope: scopeSchema.default('shared'),
  ownerUserId: optionalId,
  nature: z.enum(EXPENSE_NATURES).nullable().optional(),
  /** Planned amount for each month, January to December, in the plan's currency. */
  amounts: z.array(moneySchema).length(12),
});
export type BudgetLineInput = z.input<typeof budgetLineInputSchema>;

export const budgetPlanInputSchema = z.object({
  currency: currencySchema,
  lines: z.array(budgetLineInputSchema),
});
export type BudgetPlanInput = z.input<typeof budgetPlanInputSchema>;

export const copyBudgetInputSchema = z.object({
  /** Percentage applied to every amount, e.g. 5 = +5%. */
  adjustPct: z.coerce.number().min(-100).max(1000).default(0),
});

export const yearParamsSchema = z.object({ year: z.coerce.number().int().min(2000).max(2100) });

// ---------------------------------------------------------------- goals & debts

export const goalInputSchema = z.object({
  name: nameField,
  targetAmount: moneySchema,
  currency: currencySchema,
  targetDate: isoDateSchema.nullable().optional(),
  /** Null = shared goal. */
  ownerUserId: optionalId,
  accountId: optionalId,
  archived: z.boolean().optional(),
});
export type GoalInput = z.input<typeof goalInputSchema>;

export const goalContributionInputSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/)),
  date: isoDateSchema,
});

export const debtInputSchema = z.object({
  name: nameField,
  type: z.enum(DEBT_TYPES),
  originalAmount: moneySchema,
  currency: currencySchema,
  interestRate: z.coerce.number().min(0).max(1000).nullable().optional(),
  minPayment: moneySchema.nullable().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  startDate: isoDateSchema,
  /** Null = shared debt. */
  ownerUserId: optionalId,
  archived: z.boolean().optional(),
});
export type DebtInput = z.input<typeof debtInputSchema>;

/** Links a fixed expense to a loan: an existing debt or a new one created from it. */
export const linkDebtInputSchema = z
  .object({
    debtId: optionalId,
    newDebt: z
      .object({
        name: nameField,
        type: z.enum(DEBT_TYPES).default('loan'),
        /** Original amount (with past payments) or today's balance (without them). */
        originalAmount: moneySchema,
        interestRate: z.coerce.number().min(0).max(1000).nullable().optional(),
        startDate: isoDateSchema,
      })
      .optional(),
    /** Register the occurrences already paid as payments of the debt. */
    includePastPayments: z.boolean().default(true),
  })
  .refine((v) => Boolean(v.debtId) !== Boolean(v.newDebt), { message: 'Elige una deuda existente o crea una nueva' });
export type LinkDebtInput = z.input<typeof linkDebtInputSchema>;

export const debtPaymentInputSchema = z.object({
  date: isoDateSchema,
  amount: moneySchema,
  interestPortion: moneySchema.default('0'),
  /** Also register the payment as an expense (fixed, category "Préstamos" if it exists). */
  createExpense: z.boolean().default(false),
  accountId: optionalId,
});

// ---------------------------------------------------------------- reports

export const upcomingQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(400).default(30) });

export const reportQuerySchema = z.object({
  month: monthSchema,
  currency: currencySchema.optional(),
  /** "me" = only my personal + my share of shared; "household" = everything visible. */
  view: z.enum(['household', 'me']).default('household'),
});

export const yearReportQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  currency: currencySchema.optional(),
  view: z.enum(['household', 'me']).default('household'),
});


// ---------------------------------------------------------------- import & review

const columnName = z.string().trim().min(1).max(120).optional();

export const importMappingSchema = z.object({
  /** Header name of each column in the file. */
  columns: z.object({
    date: columnName,
    description: columnName,
    /** Single signed amount column… */
    amount: columnName,
    /** …or separate debit / credit columns. */
    debit: columnName,
    credit: columnName,
    currency: columnName,
    category: columnName,
    owner: columnName,
    type: columnName,
    account: columnName,
  }),
  /** With a single amount column: which sign is money going out. */
  amountSign: z.enum(['negative-is-debit', 'positive-is-debit']).default('negative-is-debit'),
  dateFormat: z.enum(['auto', 'dmy', 'mdy', 'ymd']).default('auto'),
});
export type ImportMapping = z.output<typeof importMappingSchema>;

export const importBatchInputSchema = z.object({
  fileName: z.string().max(255).optional(),
  source: z.enum(['csv', 'xlsx']),
  rows: z.array(z.record(z.string(), z.string())).max(5000),
  mapping: importMappingSchema,
  /** Account the statement belongs to (optional). */
  accountId: uuidSchema.nullable().optional(),
  currency: currencySchema,
  /** Only normalize and return a preview. */
  dryRun: z.boolean().default(false),
  /** Save the mapping as a reusable profile with this name. */
  saveProfileAs: z.string().trim().min(1).max(120).optional(),
});

export const inboxCommitItemSchema = z.object({
  id: uuidSchema,
  kind: z.enum(INBOX_KINDS),
  categoryId: optionalId,
  incomeSourceId: optionalId,
  transferAccountId: optionalId,
  accountId: optionalId,
  scope: scopeSchema.default('shared'),
  ownerUserId: optionalId,
  description: z.string().trim().min(1).max(255).optional(),
  /** Refunds: the purchase it returns money for (otherwise the latest one of the same merchant). */
  refundExpenseId: optionalId,
});
export type InboxCommitItem = z.input<typeof inboxCommitItemSchema>;

export const inboxCommitSchema = z.object({
  items: z.array(inboxCommitItemSchema).min(1).max(1000),
  /** Create rules so similar descriptions get the same classification next time. */
  remember: z.boolean().default(false),
});

export const inboxIgnoreSchema = z.object({ ids: z.array(uuidSchema).min(1).max(1000) });

export const categorizationRuleInputSchema = z.object({
  pattern: z.string().trim().min(2).max(255),
  kind: z.enum(RULE_KINDS),
  categoryId: optionalId,
  incomeSourceId: optionalId,
  transferAccountId: optionalId,
  scope: scopeSchema.default('shared'),
  ownerUserId: optionalId,
});
export type CategorizationRuleInput = z.input<typeof categorizationRuleInputSchema>;

export const transferInputSchema = z
  .object({
    fromAccountId: uuidSchema,
    toAccountId: uuidSchema,
    date: isoDateSchema,
    amount: moneySchema,
    /** Amount credited when the destination account uses another currency. */
    toAmount: moneySchema.nullable().optional(),
    description: z.string().trim().max(255).nullable().optional(),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, { message: 'Las cuentas deben ser distintas', path: ['toAccountId'] });
export type TransferInput = z.input<typeof transferInputSchema>;

/** Mailbox read for bank notifications (Gmail: imap.gmail.com and an app password). */
export const emailConnectionInputSchema = z.object({
  host: z.string().trim().min(1).max(255).default('imap.gmail.com'),
  port: z.coerce.number().int().min(1).max(65535).default(993),
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(255),
  mailbox: z.string().trim().min(1).max(255).default('INBOX'),
  /** Emails received before this date are not read. */
  sinceDate: isoDateSchema,
});
export type EmailConnectionInput = z.input<typeof emailConnectionInputSchema>;

export const emailConnectionUpdateSchema = z.object({
  active: z.boolean().optional(),
  password: z.string().min(1).max(255).optional(),
  mailbox: z.string().trim().min(1).max(255).optional(),
  sinceDate: isoDateSchema.optional(),
});
