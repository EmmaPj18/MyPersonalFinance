import { CURRENCIES, convertMoney, type Currency, type Money } from '@mypersonalfinance/shared';
import Decimal from 'decimal.js';
import { and, desc, eq, lte } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { exchangeRates } from '../db/schema';

interface RateRow {
  date: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  rate: string;
}

/**
 * In-memory resolver over all the rates of a household. Picks the most recent rate on or
 * before the given date; tries the direct pair, the inverse pair, then a triangulation
 * through a third currency. Loads rates once, so it can be used for many conversions.
 */
export class FxResolver {
  private byPair = new Map<string, RateRow[]>();

  constructor(rows: RateRow[]) {
    for (const row of rows) {
      const key = `${row.fromCurrency}>${row.toCurrency}`;
      const list = this.byPair.get(key) ?? [];
      list.push(row);
      this.byPair.set(key, list);
    }
    for (const list of this.byPair.values()) list.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  static async load(db: DbOrTx, householdId: string) {
    const rows = await db
      .select({
        date: exchangeRates.date,
        fromCurrency: exchangeRates.fromCurrency,
        toCurrency: exchangeRates.toCurrency,
        rate: exchangeRates.rate,
      })
      .from(exchangeRates)
      .where(eq(exchangeRates.householdId, householdId));
    return new FxResolver(rows);
  }

  private pairRate(from: Currency, to: Currency, date: string): Decimal | null {
    const direct = this.byPair.get(`${from}>${to}`)?.find((r) => r.date <= date);
    const inverse = this.byPair.get(`${to}>${from}`)?.find((r) => r.date <= date);
    if (direct && (!inverse || direct.date >= inverse.date)) return new Decimal(direct.rate);
    if (inverse) return new Decimal(1).div(inverse.rate);
    return null;
  }

  rate(from: Currency, to: Currency, date: string): Decimal | null {
    if (from === to) return new Decimal(1);
    const direct = this.pairRate(from, to, date);
    if (direct) return direct;
    for (const via of CURRENCIES) {
      if (via === from || via === to) continue;
      const a = this.pairRate(from, via, date);
      const b = a && this.pairRate(via, to, date);
      if (a && b) return a.times(b);
    }
    return null;
  }

  /** Converts an amount; returns null when no rate is available. */
  convert(amount: Decimal.Value, from: Currency, to: Currency, date: string): Money | null {
    const rate = this.rate(from, to, date);
    return rate ? convertMoney(amount, rate) : null;
  }
}

/** Single lookup without loading all rates (most recent direct rate on/before date). */
export const findDirectRate = async (db: DbOrTx, householdId: string, from: Currency, to: Currency, date: string) => {
  const [row] = await db
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.householdId, householdId),
        eq(exchangeRates.fromCurrency, from),
        eq(exchangeRates.toCurrency, to),
        lte(exchangeRates.date, date),
      ),
    )
    .orderBy(desc(exchangeRates.date))
    .limit(1);
  return row?.rate ?? null;
};
