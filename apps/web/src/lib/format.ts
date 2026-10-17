import type {
  AccountType,
  Currency,
  DebtType,
  DeductionCategory,
  IncomeKind,
  IncomeSourceType,
  PayFrequency,
  RecurrenceFrequency,
  UserRole,
  WeekendRule,
} from '@mypersonalfinance/shared';

const formatters = new Map<string, Intl.NumberFormat>();

export const formatMoney = (value: string | number | null | undefined, currency: Currency) => {
  const key = currency;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat('es-DO', { style: 'currency', currency, minimumFractionDigits: 2 }));
  }
  return formatters.get(key)!.format(Number(value ?? 0));
};

export const formatPct = (value: string | number) => `${Number(value).toLocaleString('es-DO', { maximumFractionDigits: 1 })}%`;

export const formatDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });

export const formatMonth = (month: string) => {
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const currentMonth = () => new Date().toISOString().slice(0, 7);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const CURRENCY_LABELS: Record<Currency, string> = { DOP: 'DOP — Peso dominicano', USD: 'USD — Dólar', EUR: 'EUR — Euro' };

export const ROLE_LABELS: Record<UserRole, string> = { owner: 'Dueño', member: 'Miembro', viewer: 'Solo lectura' };

export const SOURCE_TYPE_LABELS: Record<IncomeSourceType, string> = {
  formal_employment: 'Empleo formal',
  informal_employment: 'Empleo informal',
  freelance: 'Freelance',
  investment: 'Inversión',
  savings_interest: 'Intereses de ahorro',
  rental: 'Alquiler',
  other: 'Otro',
};

export const INCOME_KIND_LABELS: Record<IncomeKind, string> = {
  salary: 'Salario',
  bonus: 'Bono',
  freelance: 'Pago freelance',
  investment_return: 'Rendimiento',
  interest: 'Intereses',
  dividend: 'Dividendos',
  other: 'Otro',
};

export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Bisemanal (cada 2 semanas)',
  semimonthly: 'Quincenal',
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  yearly: 'Anual',
  irregular: 'Irregular',
};

export const RECURRENCE_LABELS: Record<RecurrenceFrequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Cada 2 semanas',
  semimonthly: 'Quincenal (2 veces al mes)',
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  yearly: 'Anual',
};

export const WEEKEND_RULE_LABELS: Record<WeekendRule, string> = {
  none: 'Mantener la fecha',
  previous: 'Mover al viernes anterior',
  next: 'Mover al lunes siguiente',
};

/** Short date without year, e.g. "15 nov". */
export const formatShortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });

export const DEDUCTION_CATEGORY_LABELS: Record<DeductionCategory, string> = {
  income_tax: 'Impuesto sobre la renta',
  social_security: 'Seguridad social',
  pension: 'Pensión',
  health: 'Salud',
  loan: 'Préstamo',
  union: 'Sindicato / Asociación',
  other: 'Otro',
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Banco',
  cash: 'Efectivo',
  credit_card: 'Tarjeta de crédito',
  savings: 'Ahorro',
  investment: 'Inversión',
};

export const DEBT_TYPE_LABELS: Record<DebtType, string> = {
  loan: 'Préstamo',
  credit_card: 'Tarjeta de crédito',
  mortgage: 'Hipoteca',
  other: 'Otra',
};
