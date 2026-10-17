import { sql, max, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { marketRates } from '../db/schema';
import { addDays, todayIn } from '../lib/dates';
import { fetchBcrd, fetchEcb, fetchErApi, fetchInfodolar, type Fetcher, type MarketQuote } from '../modules/fx-rates/providers';

const HISTORY_START = '2024-01-01';
const TIMEZONE = 'America/Santo_Domingo';

export const saveQuotes = async (db: DbOrTx, quotes: MarketQuote[]) => {
  for (let i = 0; i < quotes.length; i += 500) {
    await db
      .insert(marketRates)
      .values(quotes.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [marketRates.source, marketRates.entity, marketRates.date, marketRates.fromCurrency, marketRates.toCurrency],
        set: { buy: sql`excluded.buy`, sell: sql`excluded.sell`, mid: sql`excluded.mid`, fetchedAt: sql`now()` },
      });
  }
  return quotes.length;
};

const latest = async (db: DbOrTx, source: 'bcrd' | 'ecb') => {
  const [row] = await db.select({ date: max(marketRates.date) }).from(marketRates).where(eq(marketRates.source, source));
  return row?.date ?? null;
};

/**
 * Pulls market rates: BCRD (official USD/DOP), ECB (EUR/USD) and Infodolar (per entity).
 * open.er-api.com is used only when the BCRD rate is missing or stale. Each source fails on its own.
 */
export const runFxSync = async (db: DbOrTx, fetcher: Fetcher = fetch, today = todayIn(TIMEZONE)) => {
  const result: Record<string, number> = {};
  const errors: string[] = [];
  const attempt = async (name: string, job: () => Promise<MarketQuote[]>) => {
    try {
      result[name] = await saveQuotes(db, await job());
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Re-read the last week too: sources sometimes correct recent values.
  const since = async (source: 'bcrd' | 'ecb') => {
    const last = await latest(db, source);
    return last ? addDays(last, -7) : HISTORY_START;
  };
  await attempt('bcrd', async () => fetchBcrd(fetcher, await since('bcrd')));
  await attempt('ecb', async () => fetchEcb(fetcher, await since('ecb'), today));
  await attempt('infodolar', () => fetchInfodolar(fetcher, today));

  const lastBcrd = await latest(db, 'bcrd');
  if (!lastBcrd || lastBcrd < addDays(today, -4)) await attempt('erapi', () => fetchErApi(fetcher, today));

  return { saved: result, errors };
};
