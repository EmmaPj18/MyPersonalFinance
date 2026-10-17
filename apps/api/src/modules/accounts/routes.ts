import { accountInputSchema, idParamsSchema, sumMoney, type Currency } from '@mypersonalfinance/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accounts } from '../../db/schema';
import { assertCanEdit, assertMembers, assertOwners, visibilityFilter } from '../../lib/access';
import { notFound } from '../../lib/errors';
import { FxResolver } from '../../lib/fx';
import { currentUser } from '../../plugins/auth';
import { transferMovements } from '../import/service';

const today = () => new Date().toISOString().slice(0, 10);

export const accountRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const findAccount = async (householdId: string, id: string) => {
    const [row] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)));
    if (!row) throw notFound('Cuenta no encontrada');
    return row;
  };

  app.get('/accounts', { preHandler: app.authenticate }, async (request) => {
    const user = currentUser(request);
    const rows = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.householdId, user.householdId), visibilityFilter(user, accounts.ownerUserId)))
      .orderBy(accounts.name);

    // Movements per account and currency: net incomes in, paid expenses out.
    const movements = await db.execute<{ account_id: string; currency: Currency; total: string }>(sql`
      select account_id, currency, sum(amount)::text as total from (
        select account_id, currency, net_amount as amount from income_entries where household_id = ${user.householdId} and account_id is not null
        union all
        select account_id, currency, -amount from expenses where household_id = ${user.householdId} and account_id is not null and status = 'paid'
        union all
        ${transferMovements(user.householdId)}
      ) m group by account_id, currency`);
    const fx = await FxResolver.load(db, user.householdId);
    const date = today();

    return rows.map((account) => {
      const parts = movements.rows.filter((m) => m.account_id === account.id);
      let missingRate = false;
      const converted = parts.map((m) => {
        const value = fx.convert(m.total, m.currency, account.currency, date);
        if (value === null) missingRate = true;
        return value ?? '0';
      });
      return { ...account, balance: sumMoney([account.openingBalance, ...converted]), missingRate };
    });
  });

  app.post('/accounts', { preHandler: app.requireWriter, schema: { body: accountInputSchema } }, async (request, reply) => {
    const user = currentUser(request);
    const input = request.body;
    await assertOwners(db, user.householdId, [input.ownerUserId]);
    assertCanEdit(user, input.ownerUserId ?? null);
    const [row] = await db
      .insert(accounts)
      .values({ ...input, ownerUserId: input.ownerUserId ?? null, householdId: user.householdId })
      .returning();
    return reply.status(201).send(row);
  });

  app.put(
    '/accounts/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: accountInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const existing = await findAccount(user.householdId, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      const input = request.body;
      await assertOwners(db, user.householdId, [input.ownerUserId]);
      assertCanEdit(user, input.ownerUserId ?? null);
      const [row] = await db
        .update(accounts)
        .set({ ...input, ownerUserId: input.ownerUserId ?? null })
        .where(eq(accounts.id, existing.id))
        .returning();
      return row;
    },
  );

  app.delete(
    '/accounts/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      const existing = await findAccount(user.householdId, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      // References are nulled by the FKs (on delete set null).
      await db.delete(accounts).where(eq(accounts.id, existing.id));
      return reply.status(204).send();
    },
  );
};
