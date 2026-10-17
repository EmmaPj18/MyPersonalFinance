import { CURRENCIES, type Currency, type Direction, type ImportMapping } from '@mypersonalfinance/shared';
import Decimal from 'decimal.js';

/** A spreadsheet/CSV row keyed by column header. */
export type RawRow = Record<string, string>;

export interface NormalizedRow {
  /** 1-based row number in the file (for error messages and dedupe). */
  row: number;
  date: string;
  description: string;
  amount: string;
  direction: Direction;
  currency: Currency;
  /** Optional columns from our template / richer exports. */
  category?: string;
  owner?: string;
  type?: string;
  account?: string;
}

/** Lowercase, without accents or repeated spaces: used to compare headers, names and descriptions. */
export const normalizeText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Parses amounts as banks export them: "1,234.56", "1.234,56", "RD$ 1 234,56", "(45.00)", "-45".
 * Returns a signed Decimal or null when it isn't a number.
 */
export const parseAmount = (text: string): Decimal | null => {
  let t = text.trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || /^-/.test(t) || /-$/.test(t);
  t = t.replace(/[^\d.,]/g, '');
  if (!t) return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Both present: the last one is the decimal separator.
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (lastComma > -1) {
    // Only commas: decimal when followed by 1–2 digits at the end and it's the only one.
    const decimals = t.length - lastComma - 1;
    t = t.split(',').length === 2 && decimals > 0 && decimals <= 2 ? t.replace(',', '.') : t.replace(/,/g, '');
  } else if (lastDot > -1 && t.split('.').length > 2) {
    t = t.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const value = new Decimal(t);
  return negative ? value.neg() : value;
};

const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/**
 * Parses dates: ISO (with or without time), day/month/year with / - or . (2 or 4-digit
 * year), month/day/year and Excel serial numbers. `auto` assumes day first (Dominican
 * Republic) unless the first part can't be a month.
 */
export const parseDate = (text: string, format: ImportMapping['dateFormat'] = 'auto'): string | null => {
  const t = text.trim();
  if (!t) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    // Excel serial date (days since 1899-12-30).
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  const parts = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/.exec(t);
  if (!parts) return null;
  let [a, b, c] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  let y: number, m: number, d: number;
  if (parts[1]!.length === 4 || format === 'ymd') [y, m, d] = [a, b, c];
  else {
    if (c < 100) c += 2000;
    const monthFirst = format === 'mdy' || (format === 'auto' && a <= 12 && b > 12);
    [y, m, d] = monthFirst ? [c, a, b] : [c, b, a];
  }
  return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
};

const HEADER_HINTS: Record<keyof ImportMapping['columns'], string[]> = {
  date: ['fecha', 'date', 'fecha transaccion', 'fecha de transaccion', 'fecha posteo', 'fecha valor'],
  description: ['descripcion', 'concepto', 'detalle', 'description', 'comercio', 'referencia', 'narrative'],
  amount: ['monto', 'importe', 'amount', 'valor', 'total'],
  debit: ['debito', 'debitos', 'cargo', 'cargos', 'retiro', 'retiros', 'debit', 'salida'],
  credit: ['credito', 'creditos', 'abono', 'abonos', 'deposito', 'depositos', 'credit', 'entrada'],
  currency: ['moneda', 'currency', 'divisa'],
  category: ['categoria', 'category'],
  owner: ['de', 'dueno', 'persona', 'owner'],
  type: ['tipo', 'type'],
  account: ['cuenta', 'account'],
};

/** Guesses which header is which field. */
export const suggestMapping = (headers: string[]): ImportMapping['columns'] => {
  const columns: ImportMapping['columns'] = {};
  for (const [field, hints] of Object.entries(HEADER_HINTS) as [keyof ImportMapping['columns'], string[]][]) {
    const exact = headers.find((h) => hints.includes(normalizeText(h)));
    const partial = headers.find((h) => hints.some((hint) => hint.length > 3 && normalizeText(h).includes(hint)));
    const match = exact ?? partial;
    if (match && !Object.values(columns).includes(match)) columns[field] = match;
  }
  return columns;
};

const TYPE_CREDIT = ['ingreso', 'credito', 'abono', 'deposito', 'income', 'credit'];

/** Applies a column mapping to raw rows. Rows that can't be read are reported, not imported. */
export const normalizeRows = (rows: RawRow[], mapping: ImportMapping, defaultCurrency: Currency) => {
  const items: NormalizedRow[] = [];
  const errors: { row: number; message: string }[] = [];
  const c = mapping.columns;
  rows.forEach((raw, index) => {
    const row = index + 1;
    const cell = (column?: string) => (column ? (raw[column] ?? '').trim() : '');
    if (Object.values(raw).every((v) => !v?.trim())) return;

    const date = parseDate(cell(c.date), mapping.dateFormat);
    if (!date) return errors.push({ row, message: `Fecha no reconocida: "${cell(c.date)}"` });
    const description = cell(c.description) || 'Sin descripción';

    let value: Decimal | null = null;
    let direction: Direction = 'debit';
    if (c.debit || c.credit) {
      const debit = parseAmount(cell(c.debit));
      const credit = parseAmount(cell(c.credit));
      if (debit && !debit.isZero()) [value, direction] = [debit.abs(), 'debit'];
      else if (credit && !credit.isZero()) [value, direction] = [credit.abs(), 'credit'];
    } else {
      const amount = parseAmount(cell(c.amount));
      if (amount && !amount.isZero()) {
        const type = normalizeText(cell(c.type));
        if (type) direction = TYPE_CREDIT.some((t) => type.includes(t)) ? 'credit' : 'debit';
        else direction = amount.isNegative() === (mapping.amountSign === 'negative-is-debit') ? 'debit' : 'credit';
        value = amount.abs();
      }
    }
    if (!value) return errors.push({ row, message: 'Sin monto' });

    const currencyText = cell(c.currency).toUpperCase().replace('RD$', 'DOP').replace('US$', 'USD');
    const currency = (CURRENCIES as readonly string[]).includes(currencyText) ? (currencyText as Currency) : defaultCurrency;
    items.push({
      row,
      date,
      description: description.slice(0, 255),
      amount: value.toFixed(2),
      direction,
      currency,
      ...(cell(c.category) ? { category: cell(c.category) } : {}),
      ...(cell(c.owner) ? { owner: cell(c.owner) } : {}),
      ...(cell(c.type) ? { type: cell(c.type) } : {}),
      ...(cell(c.account) ? { account: cell(c.account) } : {}),
    });
  });
  return { items, errors };
};
