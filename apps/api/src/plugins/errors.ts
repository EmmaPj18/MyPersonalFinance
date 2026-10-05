import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { HttpError } from '../lib/errors';

/** Postgres error codes we translate into client errors. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

export default fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Datos inválidos',
        issues: error.validation.map((v) => ({
          path: v.instancePath,
          message: v.message,
        })),
      });
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.code ?? 'ERROR', message: error.message });
    }
    const pgCode = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    if (pgCode === PG_UNIQUE_VIOLATION) {
      return reply.status(409).send({ error: 'CONFLICT', message: 'El registro ya existe' });
    }
    if (pgCode === PG_FOREIGN_KEY_VIOLATION) {
      return reply.status(409).send({ error: 'CONFLICT', message: 'El registro está referenciado o la referencia no existe' });
    }
    if (pgCode === PG_CHECK_VIOLATION) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Datos inconsistentes' });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) {
      return reply.status(statusCode).send({ error: 'ERROR', message: (error as Error).message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'INTERNAL', message: 'Error interno' });
  });
});
