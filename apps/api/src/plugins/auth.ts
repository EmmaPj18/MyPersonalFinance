import type { Currency, PrivacyMode, UserRole } from '@mypersonalfinance/shared';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { households, sessions, users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import { hashToken, newToken } from '../lib/tokens';

export const SESSION_COOKIE = 'mpf_session';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  householdId: string;
  role: UserRole;
  defaultCurrency: Currency;
  privacyMode: PrivacyMode;
  baseCurrency: Currency;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    /** preHandler: requires a logged-in user. */
    authenticate: (request: FastifyRequest) => Promise<void>;
    /** preHandler: requires a logged-in user that can write (not viewer). */
    requireWriter: (request: FastifyRequest) => Promise<void>;
    /** preHandler: requires a household owner. */
    requireOwner: (request: FastifyRequest) => Promise<void>;
    startSession: (reply: FastifyReply, userId: string) => Promise<void>;
    endSession: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Returns the authenticated user or throws 401. Use inside handlers protected by `authenticate`. */
export const currentUser = (request: FastifyRequest): AuthUser => {
  if (!request.user) throw unauthorized();
  return request.user;
};

export default fp(async (app: FastifyInstance) => {
  const { config, db } = app;
  const ttlMs = config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        householdId: users.householdId,
        role: users.role,
        defaultCurrency: users.defaultCurrency,
        privacyMode: households.privacyMode,
        baseCurrency: households.baseCurrency,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(households, eq(households.id, users.householdId))
      .where(and(eq(sessions.id, hashToken(unsigned.value)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    // Only members with an account have sessions; email is always set for them.
    request.user = row?.email ? { ...row, email: row.email } : null;
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    if (!request.user) throw unauthorized();
  });
  app.decorate('requireWriter', async (request: FastifyRequest) => {
    if (!request.user) throw unauthorized();
    if (request.user.role === 'viewer') throw forbidden('Tu rol es de solo lectura');
  });
  app.decorate('requireOwner', async (request: FastifyRequest) => {
    if (!request.user) throw unauthorized();
    if (request.user.role !== 'owner') throw forbidden('Solo el dueño del hogar puede hacer esto');
  });

  app.decorate('startSession', async (reply: FastifyReply, userId: string) => {
    const token = newToken();
    const expiresAt = new Date(Date.now() + ttlMs);
    await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.COOKIE_SECURE,
      signed: true,
      expires: expiresAt,
    });
  });

  app.decorate('endSession', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.cookies[SESSION_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    if (unsigned?.valid && unsigned.value) {
      await db.delete(sessions).where(eq(sessions.id, hashToken(unsigned.value)));
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  });
});
