import { hash, verify } from '@node-rs/argon2';
import { changePasswordSchema, loginSchema, registerSchema, updateMeSchema } from '@mypersonalfinance/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { households, sessions, users } from '../../db/schema';
import { badRequest, conflict, unauthorized } from '../../lib/errors';
import { currentUser } from '../../plugins/auth';
import { createHousehold, openMembership } from '../household/membership';

export const hashPassword = (password: string) => hash(password);

export const findUserByEmail = async (db: import('../../db/client').DbOrTx, email: string) => {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return user ?? null;
};

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const me = async (userId: string) => {
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        defaultCurrency: users.defaultCurrency,
        defaultSplitPct: users.defaultSplitPct,
        household: {
          id: households.id,
          name: households.name,
          baseCurrency: households.baseCurrency,
          privacyMode: households.privacyMode,
        },
      })
      .from(users)
      .innerJoin(households, eq(households.id, users.householdId))
      .where(eq(users.id, userId));
    return row!;
  };

  app.post('/auth/register', { schema: { body: registerSchema } }, async (request, reply) => {
    const input = request.body;
    if (await findUserByEmail(db, input.email)) throw conflict('Ya existe una cuenta con ese email', 'EMAIL_TAKEN');
    const passwordHash = await hashPassword(input.password);
    const userId = await db.transaction(async (tx) => {
      const household = await createHousehold(tx, input.householdName ?? `Hogar de ${input.name}`, input.defaultCurrency);
      const [user] = await tx
        .insert(users)
        .values({
          email: input.email,
          name: input.name,
          passwordHash,
          defaultCurrency: input.defaultCurrency,
          householdId: household.id,
          role: 'owner',
        })
        .returning({ id: users.id });
      await openMembership(tx, user!.id, household.id, 'owner');
      return user!.id;
    });
    await app.startSession(reply, userId);
    return reply.status(201).send(await me(userId));
  });

  app.post('/auth/login', { schema: { body: loginSchema } }, async (request, reply) => {
    const user = await findUserByEmail(db, request.body.email);
    if (!user || !(await verify(user.passwordHash, request.body.password))) {
      throw unauthorized('Email o contraseña incorrectos');
    }
    await app.startSession(reply, user.id);
    return me(user.id);
  });

  app.post('/auth/logout', async (request, reply) => {
    await app.endSession(request, reply);
    return reply.status(204).send();
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (request) => me(currentUser(request).id));

  app.patch('/me', { preHandler: app.authenticate, schema: { body: updateMeSchema } }, async (request) => {
    const user = currentUser(request);
    if (Object.keys(request.body).length > 0) {
      await db.update(users).set(request.body).where(eq(users.id, user.id));
    }
    return me(user.id);
  });

  app.post(
    '/me/password',
    { preHandler: app.authenticate, schema: { body: changePasswordSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id));
      if (!row || !(await verify(row.passwordHash, request.body.currentPassword))) {
        throw badRequest('La contraseña actual no es correcta');
      }
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(request.body.newPassword) })
        .where(eq(users.id, user.id));
      // Log out every other device.
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await app.startSession(reply, user.id);
      return reply.status(204).send();
    },
  );
};
