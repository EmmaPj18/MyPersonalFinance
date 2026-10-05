import { categoryInputSchema, idParamsSchema } from '@mypersonalfinance/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { categories } from '../../db/schema';
import { assertInHousehold } from '../../lib/access';
import { notFound } from '../../lib/errors';
import { currentUser } from '../../plugins/auth';

export const categoryRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  app.get('/categories', { preHandler: app.authenticate }, async (request) => {
    const { householdId } = currentUser(request);
    return db.select().from(categories).where(eq(categories.householdId, householdId)).orderBy(categories.name);
  });

  app.post('/categories', { preHandler: app.requireWriter, schema: { body: categoryInputSchema } }, async (request, reply) => {
    const { householdId } = currentUser(request);
    await assertInHousehold(db, categories, request.body.parentId, householdId, 'categoría padre');
    const [row] = await db
      .insert(categories)
      .values({ ...request.body, householdId })
      .returning();
    return reply.status(201).send(row);
  });

  app.put(
    '/categories/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: categoryInputSchema } },
    async (request) => {
      const { householdId } = currentUser(request);
      await assertInHousehold(db, categories, request.body.parentId, householdId, 'categoría padre');
      const [row] = await db
        .update(categories)
        .set(request.body)
        .where(and(eq(categories.id, request.params.id), eq(categories.householdId, householdId)))
        .returning();
      if (!row) throw notFound('Categoría no encontrada');
      return row;
    },
  );

  app.delete(
    '/categories/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const { householdId } = currentUser(request);
      // Expenses keep existing without category (FK set null); budget items are removed.
      const [row] = await db
        .delete(categories)
        .where(and(eq(categories.id, request.params.id), eq(categories.householdId, householdId)))
        .returning({ id: categories.id });
      if (!row) throw notFound('Categoría no encontrada');
      return reply.status(204).send();
    },
  );
};
