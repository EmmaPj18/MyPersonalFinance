import { currencySchema, fxRateInputSchema, isoDateSchema } from '@mypersonalfinance/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { exchangeRates } from '../../db/schema';
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
