import { z } from 'zod';
import {
  ACCOUNT_TYPES,
  DEBT_TYPES,
  DEDUCTION_CATEGORIES,
  EXPENSE_NATURES,
  EXPENSE_STATUSES,
  INCOME_KINDS,
  INCOME_SOURCE_TYPES,
  PAY_FREQUENCIES,
  RECURRENCE_FREQUENCIES,
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

// ---------------------------------------------------------------- catalogs

export const accountInputSchema = z.object({
  name: nameField,
  type: z.enum(ACCOUNT_TYPES),
  currency: currencySchema,
  /** Null = shared account. */
  ownerUserId: optionalId,
  openingBalance: moneySchema.default('0'),
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
  dueDay: z.coerce.number().int().min(1).max(31).default(1),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable().optional(),
  isVariableAmount: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type RecurringExpenseInput = z.input<typeof recurringExpenseInputSchema>;

// ---------------------------------------------------------------- budgets

export const budgetInputSchema = z.object({
  currency: currencySchema,
  items: z.array(
    z.object({
      categoryId: uuidSchema,
      scope: scopeSchema,
      ownerUserId: optionalId,
      plannedAmount: moneySchema,
    }),
  ),
});
export type BudgetInput = z.input<typeof budgetInputSchema>;

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

export const debtPaymentInputSchema = z.object({
  date: isoDateSchema,
  amount: moneySchema,
  interestPortion: moneySchema.default('0'),
  /** Also register the payment as an expense (fixed, category "Préstamos" if it exists). */
  createExpense: z.boolean().default(false),
  accountId: optionalId,
});

// ---------------------------------------------------------------- reports

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

