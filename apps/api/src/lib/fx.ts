import { CURRENCIES, convertMoney, type Currency, type FxSide, type FxSource, type Money } from '@mypersonalfinance/shared';
import Decimal from 'decimal.js';
import { and, desc, eq, inArray, lte, or } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { exchangeRates, households, marketRates } from '../db/schema';

interface RateRow {
  date: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  rate: string;
  /** Lower wins when two rates have the same date (manual < preferred source < fallbacks). */
  priority?: number;
}

interface Candidate {
  rate: Decimal;
  date: string;
  priority: number;
}

const better = (a: Candidate | null, b: Candidate | null) =>
  !a ? b : !b ? a : a.date !== b.date ? (a.date > b.date ? a : b) : a.priority <= b.priority ? a : b;

/** Value of a market quote for the household's preferred side. */
const sideValue = (row: { buy: string | null; sell: string | null; mid: string }, side: FxSide) =>
  side === 'buy' ? (row.buy ?? row.mid) : side === 'sell' ? (row.sell ?? row.mid) : row.mid;

/**
 * In-memory resolver over the rates a household can use: its manual rates plus market rates
 * (BCRD, ECB, Infodolar, er-api). For a date it picks the most recent rate on or before it,
 * from the direct pair, the inverse pair or a triangulation through a third currency; on a tie
 * the manual rate wins, then the household's preferred source. Loads rates once.
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
    for (const list of this.byPair.values()) {
      list.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.priority ?? 0) - (b.priority ?? 0)));
    }
  }

  static async load(db: DbOrTx, householdId: string) {
    const [household] = await db
      .select({ fxSource: households.fxSource, fxEntity: households.fxEntity, fxSide: households.fxSide })
      .from(households)
      .where(eq(households.id, householdId));
    const side = household?.fxSide ?? 'mid';
    const manual = await db
      .select({
        date: exchangeRates.date,
        fromCurrency: exchangeRates.fromCurrency,
        toCurrency: exchangeRates.toCurrency,
        rate: exchangeRates.rate,
      })
      .from(exchangeRates)
      .where(eq(exchangeRates.householdId, householdId));
    const entity = household?.fxSource === 'infodolar' ? household.fxEntity : null;
    const market = await db
      .select()
      .from(marketRates)
      .where(
        or(
          inArray(marketRates.source, ['bcrd', 'ecb', 'erapi']),
          entity ? and(eq(marketRates.source, 'infodolar'), eq(marketRates.entity, entity)) : undefined,
        ),
      );
    const priority: Record<FxSource, number> = { infodolar: 1, bcrd: 2, ecb: 2, erapi: 3 };
    return new FxResolver([
      ...manual.map((r) => ({ ...r, priority: 0 })),
      ...market.map((r) => ({
        date: r.date,
        fromCurrency: r.fromCurrency,
        toCurrency: r.toCurrency,
        rate: sideValue(r, side),
        priority: priority[r.source],
      })),
    ]);
  }

  private pairRate(from: Currency, to: Currency, date: string): Candidate | null {
    const direct = this.byPair.get(`${from}>${to}`)?.find((r) => r.date <= date);
    const inverse = this.byPair.get(`${to}>${from}`)?.find((r) => r.date <= date);
    return better(
      direct ? { rate: new Decimal(direct.rate), date: direct.date, priority: direct.priority ?? 0 } : null,
      inverse ? { rate: new Decimal(1).div(inverse.rate), date: inverse.date, priority: inverse.priority ?? 0 } : null,
    );
  }

  rate(from: Currency, to: Currency, date: string): Decimal | null {
    if (from === to) return new Decimal(1);
    let best = this.pairRate(from, to, date);
    // A triangulation is only as recent as its older leg; prefer it when that's still newer.
    for (const via of CURRENCIES) {
      if (via === from || via === to) continue;
      const a = this.pairRate(from, via, date);
      const b = a && this.pairRate(via, to, date);
      if (a && b) {
        const viaCandidate = {
          rate: a.rate.times(b.rate),
          date: a.date < b.date ? a.date : b.date,
          priority: Math.max(a.priority, b.priority) + 1,
        };
        best = better(best, viaCandidate);
      }
    }
    return best?.rate ?? null;
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
