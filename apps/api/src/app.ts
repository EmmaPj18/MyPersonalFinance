import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Config } from './config';
import type { Database } from './db/client';
import { accountRoutes } from './modules/accounts/routes';
import { authRoutes } from './modules/auth/routes';
import { budgetRoutes } from './modules/budgets/routes';
import { categoryRoutes } from './modules/categories/routes';
import { debtRoutes } from './modules/debts/routes';
import { deductionTypeRoutes } from './modules/deduction-types/routes';
import { expenseRoutes } from './modules/expenses/routes';
import { fxRateRoutes } from './modules/fx-rates/routes';
import { goalRoutes } from './modules/goals/routes';
import { householdRoutes } from './modules/household/routes';
import { importRoutes } from './modules/import/routes';
import { incomeRoutes } from './modules/income/routes';
import { recurringExpenseRoutes } from './modules/recurring-expenses/routes';
import { reportRoutes } from './modules/reports/routes';
import { transferRoutes } from './modules/transfers/routes';
import authPlugin from './plugins/auth';
import errorsPlugin from './plugins/errors';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Database;
  }
}

export interface BuildAppOptions {
  config: Config;
  db: Database;
  logger?: FastifyServerOptions['logger'];
}

export const buildApp = async ({ config, db, logger = true }: BuildAppOptions) => {
  const app = Fastify({ logger, trustProxy: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('config', config);
  app.decorate('db', db);

  await app.register(errorsPlugin);
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.register(authPlugin);

  app.get('/api/health', async () => ({ status: 'ok' }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(householdRoutes);
      await api.register(accountRoutes);
      await api.register(categoryRoutes);
      await api.register(deductionTypeRoutes);
      await api.register(fxRateRoutes);
      await api.register(incomeRoutes);
      await api.register(expenseRoutes);
      await api.register(recurringExpenseRoutes);
      await api.register(budgetRoutes);
      await api.register(goalRoutes);
      await api.register(debtRoutes);
      await api.register(reportRoutes);
      await api.register(importRoutes);
      await api.register(transferRoutes);
    },
    { prefix: '/api' },
  );

  return app;
};

export type App = Awaited<ReturnType<typeof buildApp>>;
