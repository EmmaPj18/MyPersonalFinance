import { currencySchema, isoDateSchema, reportQuerySchema, yearReportQuerySchema } from '@mypersonalfinance/shared';
import Decimal from 'decimal.js';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { monthRange } from '../../lib/dates';
import { FxResolver } from '../../lib/fx';
import { currentUser } from '../../plugins/auth';
import { memberBalances, summarizeExpenses, summarizeIncome, type ConvertCtx } from './compute';
import { loadExpenses, loadIncomes } from './data';

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  app.get('/reports/monthly', { preHandler: app.authenticate, schema: { querystring: reportQuerySchema } }, async (request) => {
    const user = currentUser(request);
    const { month, view } = request.query;
    const currency = request.query.currency ?? user.defaultCurrency;
    const { from, to } = monthRange(month);
    const ctx: ConvertCtx = { fx: await FxResolver.load(db, user.householdId), currency, missing: new Set() };
    const [incomeRows, expenseRows] = await Promise.all([
      loadIncomes(db, user.householdId, from, to),
      loadExpenses(db, user.householdId, from, to),
    ]);
    const income = summarizeIncome(incomeRows, ctx, view, user.id);
    const expenses = summarizeExpenses(expenseRows, ctx, view, user.id);
    return {
      month,
      currency,
      view,
      income,
      expenses,
      netFlow: new Decimal(income.net).minus(expenses.total).toFixed(2),
      savingsRate: new Decimal(income.net).isZero()
        ? '0.00'
        : new Decimal(income.net).minus(expenses.total).div(income.net).times(100).toFixed(2),
      missingRates: [...ctx.missing],
    };
  });

  app.get('/reports/yearly', { preHandler: app.authenticate, schema: { querystring: yearReportQuerySchema } }, async (request) => {
    const user = currentUser(request);
    const { year, view } = request.query;
    const currency = request.query.currency ?? user.defaultCurrency;
    const ctx: ConvertCtx = { fx: await FxResolver.load(db, user.householdId), currency, missing: new Set() };
    const [incomeRows, expenseRows] = await Promise.all([
      loadIncomes(db, user.householdId, `${year}-01-01`, `${year}-12-31`),
      loadExpenses(db, user.householdId, `${year}-01-01`, `${year}-12-31`),
    ]);
    const months = Array.from({ length: 12 }, (_, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}`;
      const income = summarizeIncome(incomeRows.filter((r) => r.payDate.startsWith(month)), ctx, view, user.id);
      const expenses = summarizeExpenses(expenseRows.filter((r) => r.date.startsWith(month)), ctx, view, user.id);
      return {
        month,
        gross: income.gross,
        deductions: income.deductions,
        net: income.net,
        expenses: expenses.total,
        fixed: expenses.fixed,
        variable: expenses.variable,
        netFlow: new Decimal(income.net).minus(expenses.total).toFixed(2),
      };
    });
    const income = summarizeIncome(incomeRows, ctx, view, user.id);
    const expenses = summarizeExpenses(expenseRows, ctx, view, user.id);
    return {
      year,
      currency,
      view,
      months,
      totals: { income, expenses, netFlow: new Decimal(income.net).minus(expenses.total).toFixed(2) },
      missingRates: [...ctx.missing],
    };
  });

  /** Balance between members for shared expenses (who owes whom). */
  app.get(
    '/reports/member-balances',
    {
      preHandler: app.authenticate,
      schema: {
        querystring: z.object({
          from: isoDateSchema.default('2000-01-01'),
          to: isoDateSchema.default('2100-12-31'),
          currency: currencySchema.optional(),
        }),
      },
    },
    async (request) => {
      const user = currentUser(request);
      const currency = request.query.currency ?? user.defaultCurrency;
      const ctx: ConvertCtx = { fx: await FxResolver.load(db, user.householdId), currency, missing: new Set() };
      const rows = await loadExpenses(db, user.householdId, request.query.from, request.query.to);
      return { currency, ...memberBalances(rows, ctx), missingRates: [...ctx.missing] };
    },
  );
};
