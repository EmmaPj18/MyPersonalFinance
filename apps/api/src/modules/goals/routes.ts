import { goalContributionInputSchema, goalInputSchema, idParamsSchema, uuidSchema } from '@mypersonalfinance/shared';
import Decimal from 'decimal.js';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accounts, goalContributions, savingsGoals } from '../../db/schema';
import { assertCanEdit, assertInHousehold, assertMembers, visibilityFilter } from '../../lib/access';
import { notFound } from '../../lib/errors';
import { currentUser, type AuthUser } from '../../plugins/auth';

export const goalRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const findGoal = async (user: AuthUser, id: string) => {
    const [row] = await db
      .select()
      .from(savingsGoals)
      .where(
        and(
          eq(savingsGoals.id, id),
          eq(savingsGoals.householdId, user.householdId),
          visibilityFilter(user, savingsGoals.ownerUserId),
        ),
      );
    if (!row) throw notFound('Meta no encontrada');
    return row;
  };

  app.get('/goals', { preHandler: app.authenticate }, async (request) => {
    const user = currentUser(request);
    const goals = await db
      .select()
      .from(savingsGoals)
      .where(and(eq(savingsGoals.householdId, user.householdId), visibilityFilter(user, savingsGoals.ownerUserId)))
      .orderBy(savingsGoals.archived, savingsGoals.targetDate, savingsGoals.name);
    const contributions = goals.length
      ? await db
          .select()
          .from(goalContributions)
          .where(inArray(goalContributions.goalId, goals.map((g) => g.id)))
          .orderBy(desc(goalContributions.date))
      : [];
    return goals.map((goal) => {
      const own = contributions.filter((c) => c.goalId === goal.id);
      const saved = own.reduce((acc, c) => acc.plus(c.amount), new Decimal(0));
      const target = new Decimal(goal.targetAmount);
      return {
        ...goal,
        saved: saved.toFixed(2),
        remaining: Decimal.max(0, target.minus(saved)).toFixed(2),
        progressPct: target.isZero() ? '100.00' : Decimal.min(100, saved.div(target).times(100)).toFixed(2),
        contributions: own,
      };
    });
  });

  const validate = async (user: AuthUser, input: { ownerUserId?: string | null; accountId?: string | null }) => {
    await assertMembers(db, user.householdId, [input.ownerUserId]);
    assertCanEdit(user, input.ownerUserId ?? null);
    await assertInHousehold(db, accounts, input.accountId, user.householdId, 'cuenta');
  };

  app.post('/goals', { preHandler: app.requireWriter, schema: { body: goalInputSchema } }, async (request, reply) => {
    const user = currentUser(request);
    await validate(user, request.body);
    const [row] = await db
      .insert(savingsGoals)
      .values({ ...request.body, ownerUserId: request.body.ownerUserId ?? null, householdId: user.householdId })
      .returning();
    return reply.status(201).send(row);
  });

  app.put(
    '/goals/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: goalInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const existing = await findGoal(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      await validate(user, request.body);
      const [row] = await db
        .update(savingsGoals)
        .set({ ...request.body, ownerUserId: request.body.ownerUserId ?? null })
        .where(eq(savingsGoals.id, existing.id))
        .returning();
      return row;
    },
  );

  app.delete('/goals/:id', { preHandler: app.requireWriter, schema: { params: idParamsSchema } }, async (request, reply) => {
    const user = currentUser(request);
    const existing = await findGoal(user, request.params.id);
    assertCanEdit(user, existing.ownerUserId);
    await db.delete(savingsGoals).where(eq(savingsGoals.id, existing.id));
    return reply.status(204).send();
  });

  /** Positive amount = deposit, negative = withdrawal. In the goal's currency. */
  app.post(
    '/goals/:id/contributions',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: goalContributionInputSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      const goal = await findGoal(user, request.params.id);
      assertCanEdit(user, goal.ownerUserId);
      const [row] = await db
        .insert(goalContributions)
        .values({ goalId: goal.id, userId: user.id, ...request.body })
        .returning();
      return reply.status(201).send(row);
    },
  );

  app.delete(
    '/goals/:id/contributions/:contributionId',
    {
      preHandler: app.requireWriter,
      schema: { params: z.object({ id: uuidSchema, contributionId: uuidSchema }) },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const goal = await findGoal(user, request.params.id);
      assertCanEdit(user, goal.ownerUserId);
      await db
        .delete(goalContributions)
        .where(and(eq(goalContributions.id, request.params.contributionId), eq(goalContributions.goalId, goal.id)));
      return reply.status(204).send();
    },
  );
};
