import { currencySchema, fxRateInputSchema, isoDateSchema } from '@mypersonalfinance/shared';
import { and, desc, eq, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { exchangeRates, households, marketRates } from '../../db/schema';
import { runFxSync } from '../../jobs/fx';
import { todayIn } from '../../lib/dates';
import { FxResolver } from '../../lib/fx';
import { notFound } from '../../lib/errors';
import { currentUser } from '../../plugins/auth';

const rateKeySchema = z.object({
  date: isoDateSchema,
  fromCurrency: currencySchema,
  toCurrency: currencySchema,
});

export const fxRateRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  app.get('/fx-rates', { preHandler: app.authenticate }, async (request) => {
    const { householdId } = currentUser(request);
    return db
      .select()
      .from(exchangeRates)
      .where(eq(exchangeRates.householdId, householdId))
      .orderBy(desc(exchangeRates.date), exchangeRates.fromCurrency, exchangeRates.toCurrency)
      .limit(500);
  });

  /**
   * Latest market rates per source (and per entity for Infodolar), the household's preference
   * and the rates it actually uses today.
   */
  app.get('/fx-rates/market', { preHandler: app.authenticate }, async (request) => {
    const { householdId } = currentUser(request);
    const [household] = await db
      .select({ timezone: households.timezone, fxSource: households.fxSource, fxEntity: households.fxEntity, fxSide: households.fxSide })
      .from(households)
      .where(eq(households.id, householdId));
    // Latest row of each source/entity/pair.
    const latest = await db.execute<{
      source: string;
      entity: string;
      date: string;
      from_currency: string;
      to_currency: string;
      buy: string | null;
      sell: string | null;
      mid: string;
      fetched_at: string;
    }>(sql`
      select distinct on (source, entity, from_currency, to_currency) source, entity, date::text, from_currency, to_currency, buy, sell, mid, fetched_at
      from market_rates
      order by source, entity, from_currency, to_currency, date desc`);
    const [fetched] = await db.select({ at: max(marketRates.fetchedAt) }).from(marketRates);
    const today = todayIn(household?.timezone ?? 'America/Santo_Domingo');
    const fx = await FxResolver.load(db, householdId);
    const effective = (from: 'USD' | 'EUR', to: 'DOP' | 'USD') => fx.rate(from, to, today)?.toFixed(4) ?? null;
    return {
      preference: { fxSource: household?.fxSource ?? 'bcrd', fxEntity: household?.fxEntity ?? null, fxSide: household?.fxSide ?? 'mid' },
      today,
      lastFetchedAt: fetched?.at ?? null,
      effective: { USD_DOP: effective('USD', 'DOP'), EUR_DOP: effective('EUR', 'DOP'), EUR_USD: effective('EUR', 'USD') },
      quotes: latest.rows.map((r) => ({
        source: r.source,
        entity: r.entity,
        date: r.date,
        fromCurrency: r.from_currency,
        toCurrency: r.to_currency,
        buy: r.buy,
        sell: r.sell,
        mid: r.mid,
      })),
    };
  });

  /** Fetches market rates now instead of waiting for the scheduler. */
  app.post('/fx-rates/refresh', { preHandler: app.requireWriter }, async () => runFxSync(db));

  /** Upsert: one rate per day and currency pair. */
  app.put('/fx-rates', { preHandler: app.requireWriter, schema: { body: fxRateInputSchema } }, async (request) => {
    const { householdId } = currentUser(request);
    const { rate, ...key } = request.body;
    const [row] = await db
      .insert(exchangeRates)
      .values({ householdId, ...key, rate: String(rate) })
      .onConflictDoUpdate({
        target: [exchangeRates.householdId, exchangeRates.date, exchangeRates.fromCurrency, exchangeRates.toCurrency],
        set: { rate: String(rate) },
      })
      .returning();
    return row;
  });

  app.delete('/fx-rates', { preHandler: app.requireWriter, schema: { querystring: rateKeySchema } }, async (request, reply) => {
    const { householdId } = currentUser(request);
    const { date, fromCurrency, toCurrency } = request.query;
    const [row] = await db
      .delete(exchangeRates)
      .where(
        and(
          eq(exchangeRates.householdId, householdId),
          eq(exchangeRates.date, date),
          eq(exchangeRates.fromCurrency, fromCurrency),
          eq(exchangeRates.toCurrency, toCurrency),
        ),
      )
      .returning();
    if (!row) throw notFound('Tasa no encontrada');
    return reply.status(204).send();
  });
};
