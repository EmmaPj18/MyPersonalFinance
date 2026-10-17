import { idParamsSchema, transferInputSchema } from '@mypersonalfinance/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accounts, accountTransfers } from '../../db/schema';
import { assertCanEdit } from '../../lib/access';
import { badRequest, notFound } from '../../lib/errors';
import { currentUser } from '../../plugins/auth';

/** Transfers between the household's own accounts: they move balances but aren't expenses. */
export const transferRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  app.get('/transfers', { preHandler: app.authenticate }, async (request) =>
    db
      .select()
      .from(accountTransfers)
      .where(eq(accountTransfers.householdId, currentUser(request).householdId))
      .orderBy(desc(accountTransfers.date), desc(accountTransfers.createdAt))
      .limit(500),
  );

  app.post('/transfers', { preHandler: app.requireWriter, schema: { body: transferInputSchema } }, async (request, reply) => {
    const user = currentUser(request);
    const input = request.body;
    const accs = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.householdId, user.householdId), inArray(accounts.id, [input.fromAccountId, input.toAccountId])));
    const from = accs.find((a) => a.id === input.fromAccountId);
    const to = accs.find((a) => a.id === input.toAccountId);
    if (!from || !to) throw badRequest('Cuenta inválida');
    assertCanEdit(user, from.ownerUserId);
    assertCanEdit(user, to.ownerUserId);
    if (from.currency !== to.currency && !input.toAmount) throw badRequest(`Indica cuánto llegó en ${to.currency}`);
    const [row] = await db
      .insert(accountTransfers)
      .values({
        householdId: user.householdId,
        fromAccountId: from.id,
        toAccountId: to.id,
        date: input.date,
        amount: input.amount,
        currency: from.currency,
        toAmount: from.currency !== to.currency ? (input.toAmount ?? null) : null,
        description: input.description ?? null,
        createdBy: user.id,
      })
      .returning();
    return reply.status(201).send(row);
  });

  app.delete('/transfers/:id', { preHandler: app.requireWriter, schema: { params: idParamsSchema } }, async (request, reply) => {
    const [row] = await db
      .delete(accountTransfers)
      .where(and(eq(accountTransfers.id, request.params.id), eq(accountTransfers.householdId, currentUser(request).householdId)))
      .returning({ id: accountTransfers.id });
    if (!row) throw notFound('Transferencia no encontrada');
    return reply.status(204).send();
  });
};
