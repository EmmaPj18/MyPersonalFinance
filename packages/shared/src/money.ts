import Decimal from 'decimal.js';

/** Money values travel as strings with 2 decimals ("1234.50") to avoid float errors. */
export type Money = string;

export const toMoney = (value: Decimal.Value): Money => new Decimal(value).toFixed(2);

export const sumMoney = (values: Decimal.Value[]): Money =>
  toMoney(values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0)));

export const subMoney = (a: Decimal.Value, b: Decimal.Value): Money => toMoney(new Decimal(a).minus(b));

export const isNegative = (value: Decimal.Value): boolean => new Decimal(value).isNegative();

/** Net = gross - sum(deductions). */
export const computeNet = (gross: Decimal.Value, deductions: Decimal.Value[]): Money =>
  subMoney(gross, sumMoney(deductions));

export const convertMoney = (amount: Decimal.Value, rate: Decimal.Value): Money =>
  toMoney(new Decimal(amount).times(rate));

/**
 * Splits `amount` by percentages, making sure the parts add up exactly to the total
 * (the rounding remainder goes to the last share).
 */
export const splitByPct = (amount: Decimal.Value, pcts: Decimal.Value[]): Money[] => {
  const total = new Decimal(amount);
  const parts = pcts.map((p) => total.times(p).div(100).toDecimalPlaces(2, Decimal.ROUND_DOWN));
  const assigned = parts.reduce((acc, p) => acc.plus(p), new Decimal(0));
  if (parts.length > 0) parts[parts.length - 1] = parts[parts.length - 1]!.plus(total.minus(assigned));
  return parts.map(toMoney);
};

export const pctsSumTo100 = (pcts: Decimal.Value[]): boolean =>
  pcts.reduce<Decimal>((acc, p) => acc.plus(p), new Decimal(0)).equals(100);
