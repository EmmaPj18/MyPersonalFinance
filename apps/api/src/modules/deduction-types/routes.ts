import { deductionTypeInputSchema, idParamsSchema } from '@mypersonalfinance/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { deductionTypes } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { currentUser } from '../../plugins/auth';

export const deductionTypeRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  app.get('/deduction-types', { preHandler: app.authenticate }, async (request) => {
    const { householdId } = currentUser(request);
    return db.select().from(deductionTypes).where(eq(deductionTypes.householdId, householdId)).orderBy(deductionTypes.name);
  });

  app.post(
    '/deduction-types',
    { preHandler: app.requireWriter, schema: { body: deductionTypeInputSchema } },
    async (request, reply) => {
      const { householdId } = currentUser(request);
      const [row] = await db
        .insert(deductionTypes)
        .values({ ...request.body, householdId })
        .returning();
      return reply.status(201).send(row);
    },
  );

  app.put(
    '/deduction-types/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: deductionTypeInputSchema } },
    async (request) => {
      const { householdId } = currentUser(request);
      const [row] = await db
        .update(deductionTypes)
        .set(request.body)
        .where(and(eq(deductionTypes.id, request.params.id), eq(deductionTypes.householdId, householdId)))
        .returning();
      if (!row) throw notFound('Tipo de descuento no encontrado');
      return row;
    },
  );

  /** Deduction types already used in payments can't be deleted (archive them instead). */
  app.delete(
    '/deduction-types/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const { householdId } = currentUser(request);
      const [row] = await db
        .delete(deductionTypes)
        .where(and(eq(deductionTypes.id, request.params.id), eq(deductionTypes.householdId, householdId)))
        .returning({ id: deductionTypes.id });
      if (!row) throw notFound('Tipo de descuento no encontrado');
      return reply.status(204).send();
    },
  );
};
