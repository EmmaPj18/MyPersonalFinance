import { debtInputSchema, debtPaymentInputSchema, idParamsSchema, subMoney, uuidSchema } from '@mypersonalfinance/shared';
import Decimal from 'decimal.js';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accounts, categories, debtPayments, debts, expenses } from '../../db/schema';
import { assertCanEdit, assertInHousehold, assertMembers, assertOwners, resolveSplits, visibilityFilter } from '../../lib/access';
import { badRequest, notFound } from '../../lib/errors';
import { currentUser, type AuthUser } from '../../plugins/auth';
import { writeSplits } from '../expenses/service';

export const debtRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const findDebt = async (user: AuthUser, id: string) => {
    const [row] = await db
      .select()
      .from(debts)
      .where(and(eq(debts.id, id), eq(debts.householdId, user.householdId), visibilityFilter(user, debts.ownerUserId)));
    if (!row) throw notFound('Deuda no encontrada');
    return row;
  };

  app.get('/debts', { preHandler: app.authenticate }, async (request) => {
    const user = currentUser(request);
    const rows = await db
      .select()
      .from(debts)
      .where(and(eq(debts.householdId, user.householdId), visibilityFilter(user, debts.ownerUserId)))
      .orderBy(debts.archived, debts.name);
    const payments = rows.length
      ? await db
          .select()
          .from(debtPayments)
          .where(inArray(debtPayments.debtId, rows.map((d) => d.id)))
          .orderBy(desc(debtPayments.date))
      : [];
    return rows.map((debt) => {
      const own = payments.filter((p) => p.debtId === debt.id);
      const principalPaid = own.reduce((acc, p) => acc.plus(p.principalPortion), new Decimal(0));
      const interestPaid = own.reduce((acc, p) => acc.plus(p.interestPortion), new Decimal(0));
      const original = new Decimal(debt.originalAmount);
      return {
        ...debt,
        principalPaid: principalPaid.toFixed(2),
        interestPaid: interestPaid.toFixed(2),
        balance: Decimal.max(0, original.minus(principalPaid)).toFixed(2),
        progressPct: original.isZero() ? '100.00' : Decimal.min(100, principalPaid.div(original).times(100)).toFixed(2),
        payments: own,
      };
    });
  });

  app.post('/debts', { preHandler: app.requireWriter, schema: { body: debtInputSchema } }, async (request, reply) => {
    const user = currentUser(request);
    const input = request.body;
    await assertOwners(db, user.householdId, [input.ownerUserId]);
    assertCanEdit(user, input.ownerUserId ?? null);
    const [row] = await db
      .insert(debts)
      .values({
        ...input,
        ownerUserId: input.ownerUserId ?? null,
        interestRate: input.interestRate == null ? null : String(input.interestRate),
        householdId: user.householdId,
      })
      .returning();
    return reply.status(201).send(row);
  });

  app.put(
    '/debts/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: debtInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const existing = await findDebt(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      const input = request.body;
      await assertOwners(db, user.householdId, [input.ownerUserId]);
      assertCanEdit(user, input.ownerUserId ?? null);
      const [row] = await db
        .update(debts)
        .set({
          ...input,
          ownerUserId: input.ownerUserId ?? null,
          interestRate: input.interestRate == null ? null : String(input.interestRate),
        })
        .where(eq(debts.id, existing.id))
        .returning();
      return row;
    },
  );

  app.delete('/debts/:id', { preHandler: app.requireWriter, schema: { params: idParamsSchema } }, async (request, reply) => {
    const user = currentUser(request);
    const existing = await findDebt(user, request.params.id);
    assertCanEdit(user, existing.ownerUserId);
    await db.delete(debts).where(eq(debts.id, existing.id));
    return reply.status(204).send();
  });

  /** Registers a payment; optionally also as a fixed expense so it counts in the month's spending. */
  app.post(
    '/debts/:id/payments',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: debtPaymentInputSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      const debt = await findDebt(user, request.params.id);
      assertCanEdit(user, debt.ownerUserId);
      const input = request.body;
      if (new Decimal(input.interestPortion).greaterThan(input.amount)) {
        throw badRequest('El interés no puede superar el pago');
      }
      await assertInHousehold(db, accounts, input.accountId, user.householdId, 'cuenta');

      const result = await db.transaction(async (tx) => {
        let expenseId: string | null = null;
        if (input.createExpense) {
          const [loanCategory] = await tx
            .select({ id: categories.id })
            .from(categories)
            .where(and(eq(categories.householdId, user.householdId), sql`lower(${categories.name}) = 'préstamos'`));
          const scope = debt.ownerUserId ? 'personal' : 'shared';
          const [expense] = await tx
            .insert(expenses)
            .values({
              householdId: user.householdId,
              categoryId: loanCategory?.id ?? null,
              accountId: input.accountId ?? null,
              paidByUserId: user.id,
              amount: input.amount,
              currency: debt.currency,
              date: input.date,
              description: `Pago ${debt.name}`,
              nature: 'fixed',
              scope,
              ownerUserId: debt.ownerUserId,
              status: 'paid',
              createdBy: user.id,
            })
            .returning();
          if (scope === 'shared') await writeSplits(tx, expense!.id, expense!.amount, await resolveSplits(tx, user.householdId, undefined));
          expenseId = expense!.id;
        }
        const [payment] = await tx
          .insert(debtPayments)
          .values({
            debtId: debt.id,
            userId: user.id,
            date: input.date,
            amount: input.amount,
            interestPortion: input.interestPortion,
            principalPortion: subMoney(input.amount, input.interestPortion),
            expenseId,
          })
          .returning();
        return payment;
      });
      return reply.status(201).send(result);
    },
  );

  app.delete(
    '/debts/:id/payments/:paymentId',
    { preHandler: app.requireWriter, schema: { params: z.object({ id: uuidSchema, paymentId: uuidSchema }) } },
    async (request, reply) => {
      const user = currentUser(request);
      const debt = await findDebt(user, request.params.id);
      assertCanEdit(user, debt.ownerUserId);
      await db.transaction(async (tx) => {
        const [payment] = await tx
          .delete(debtPayments)
          .where(and(eq(debtPayments.id, request.params.paymentId), eq(debtPayments.debtId, debt.id)))
          .returning();
        // The linked expense was created by the payment, remove it too.
        if (payment?.expenseId) await tx.delete(expenses).where(eq(expenses.id, payment.expenseId));
      });
      return reply.status(204).send();
    },
  );
};
