import {
  acceptInvitationSchema,
  claimInvitationSchema,
  createInvitationSchema,
  createManagedMemberSchema,
  idParamsSchema,
  transferOwnershipSchema,
  updateHouseholdSchema,
  updateMemberSchema,
} from '@mypersonalfinance/shared';
import { and, eq, gt, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { householdInvitations, householdMembershipHistory, households, users } from '../../db/schema';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../lib/errors';
import { hashToken, newToken } from '../../lib/tokens';
import { currentUser } from '../../plugins/auth';
import { findUserByEmail, hashPassword } from '../auth/routes';
import { leavePreview, mergeManagedMember, moveUser, openMembership } from './membership';

const INVITATION_TTL_DAYS = 7;

export const householdRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const memberOf = async (householdId: string, userId: string) => {
    const [member] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.householdId, householdId)));
    if (!member) throw notFound('Miembro no encontrado');
    return member;
  };

  app.get('/household', { preHandler: app.authenticate }, async (request) => {
    const { householdId } = currentUser(request);
    const [household] = await db.select().from(households).where(eq(households.id, householdId));
    const members = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        defaultSplitPct: users.defaultSplitPct,
        defaultCurrency: users.defaultCurrency,
        accountStatus: users.accountStatus,
      })
      .from(users)
      .where(eq(users.householdId, householdId))
      .orderBy(users.createdAt);
    // People who belonged to this household and left (still referenced by shared records).
    const exMembers = await db
      .selectDistinctOn([users.id], { id: users.id, name: users.name, leftAt: householdMembershipHistory.leftAt })
      .from(householdMembershipHistory)
      .innerJoin(users, eq(users.id, householdMembershipHistory.userId))
      .where(
        and(
          eq(householdMembershipHistory.householdId, householdId),
          isNotNull(householdMembershipHistory.leftAt),
          ne(users.householdId, householdId),
        ),
      );
    return { ...household!, members, exMembers };
  });

  app.patch('/household', { preHandler: app.requireOwner, schema: { body: updateHouseholdSchema } }, async (request) => {
    const { householdId } = currentUser(request);
    if (request.body.fxSource === 'infodolar' && !request.body.fxEntity) {
      throw badRequest('Elige el banco o casa de cambio de Infodolar');
    }
    const [household] = await db.update(households).set(request.body).where(eq(households.id, householdId)).returning();
    return household;
  });

  /** Adds a member without an account (e.g. a partner who hasn't signed up yet). */
  app.post(
    '/household/members',
    { preHandler: app.requireOwner, schema: { body: createManagedMemberSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      const { name, defaultSplitPct } = request.body;
      const member = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            name,
            householdId: user.householdId,
            role: 'member',
            accountStatus: 'managed',
            defaultCurrency: user.baseCurrency,
            defaultSplitPct: defaultSplitPct == null ? null : String(defaultSplitPct),
          })
          .returning({ id: users.id, name: users.name, accountStatus: users.accountStatus });
        await openMembership(tx, row!.id, user.householdId, 'member');
        return row!;
      });
      return reply.status(201).send(member);
    },
  );

  app.patch(
    '/household/members/:id',
    { preHandler: app.requireOwner, schema: { params: idParamsSchema, body: updateMemberSchema } },
    async (request) => {
      const user = currentUser(request);
      const member = await memberOf(user.householdId, request.params.id);
      const { role, defaultSplitPct, name } = request.body;
      if (member.accountStatus === 'managed' && role && role !== 'member') {
        throw badRequest('Un miembro sin cuenta no puede tener ese rol');
      }
      if (name && member.accountStatus !== 'managed') throw badRequest('Cada persona con cuenta edita su propio nombre');
      if (role && role !== 'owner' && member.role === 'owner') {
        const [owners] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.householdId, user.householdId), eq(users.role, 'owner')));
        if (Number(owners?.n) <= 1) throw conflict('El hogar debe tener al menos un dueño', 'LAST_OWNER');
      }
      const [updated] = await db
        .update(users)
        .set({
          ...(role ? { role } : {}),
          ...(name ? { name } : {}),
          ...(defaultSplitPct !== undefined ? { defaultSplitPct: defaultSplitPct === null ? null : String(defaultSplitPct) } : {}),
        })
        .where(eq(users.id, member.id))
        .returning({ id: users.id, name: users.name, role: users.role, defaultSplitPct: users.defaultSplitPct });
      return updated;
    },
  );

  /** Removing a member sends them (with their personal data) to a new personal household. */
  app.delete(
    '/household/members/:id',
    { preHandler: app.requireOwner, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      if (request.params.id === user.id) throw badRequest('Para salir del hogar usa "Salir del hogar"');
      const member = await memberOf(user.householdId, request.params.id);
      if (member.accountStatus === 'managed') {
        try {
          await db.transaction(async (tx) => {
            await tx.delete(householdMembershipHistory).where(eq(householdMembershipHistory.userId, member.id));
            await tx.delete(users).where(eq(users.id, member.id));
          });
        } catch {
          throw conflict('Este miembro participa en gastos o ingresos; cambia esos repartos antes de eliminarlo', 'MEMBER_IN_USE');
        }
        return reply.status(204).send();
      }
      await db.transaction((tx) => moveUser(tx, request.params.id, null, user.id));
      return reply.status(204).send();
    },
  );

  app.post(
    '/household/transfer-ownership',
    { preHandler: app.requireOwner, schema: { body: transferOwnershipSchema } },
    async (request) => {
      const user = currentUser(request);
      const target = await memberOf(user.householdId, request.body.userId);
      if (target.id === user.id) throw badRequest('Ya eres dueño');
      await db.transaction(async (tx) => {
        await tx.update(users).set({ role: 'owner' }).where(eq(users.id, target.id));
        await tx.update(users).set({ role: 'member' }).where(eq(users.id, user.id));
      });
      return { ok: true };
    },
  );

  app.get('/household/leave-preview', { preHandler: app.authenticate }, async (request) => {
    const user = currentUser(request);
    return leavePreview(db, user.id, user.householdId);
  });

  app.post('/household/leave', { preHandler: app.authenticate }, async (request) => {
    const user = currentUser(request);
    return db.transaction((tx) => moveUser(tx, user.id, null, user.id));
  });

  // ------------------------------------------------------------ invitations

  app.get('/household/invitations', { preHandler: app.requireOwner }, async (request) => {
    const { householdId } = currentUser(request);
    return db
      .select({
        id: householdInvitations.id,
        email: householdInvitations.email,
        role: householdInvitations.role,
        expiresAt: householdInvitations.expiresAt,
        createdAt: householdInvitations.createdAt,
      })
      .from(householdInvitations)
      .where(
        and(
          eq(householdInvitations.householdId, householdId),
          isNull(householdInvitations.acceptedAt),
          isNull(householdInvitations.revokedAt),
          gt(householdInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(householdInvitations.createdAt);
  });

  /** Invites someone to take over the account of a member without one. */
  app.post(
    '/household/members/:id/invite',
    { preHandler: app.requireOwner, schema: { params: idParamsSchema, body: claimInvitationSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      const member = await memberOf(user.householdId, request.params.id);
      if (member.accountStatus !== 'managed') throw badRequest('Ese miembro ya tiene cuenta');
      const token = newToken();
      const [invitation] = await db
        .insert(householdInvitations)
        .values({
          householdId: user.householdId,
          email: request.body.email,
          role: 'member',
          tokenHash: hashToken(token),
          invitedBy: user.id,
          memberId: member.id,
          expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
        })
        .returning({ id: householdInvitations.id, email: householdInvitations.email, expiresAt: householdInvitations.expiresAt });
      return reply.status(201).send({ ...invitation!, url: `${app.config.WEB_ORIGIN}/invitations/${token}` });
    },
  );

  app.post(
    '/household/invitations',
    { preHandler: app.requireOwner, schema: { body: createInvitationSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      const existing = await findUserByEmail(db, request.body.email);
      if (existing?.householdId === user.householdId) throw conflict('Esa persona ya es miembro del hogar');
      const token = newToken();
      const [invitation] = await db
        .insert(householdInvitations)
        .values({
          householdId: user.householdId,
          email: request.body.email,
          role: request.body.role,
          tokenHash: hashToken(token),
          invitedBy: user.id,
          expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
        })
        .returning({ id: householdInvitations.id, email: householdInvitations.email, expiresAt: householdInvitations.expiresAt });
      // No email delivery yet: the owner shares this link.
      return reply.status(201).send({ ...invitation!, url: `${app.config.WEB_ORIGIN}/invitations/${token}` });
    },
  );

  app.delete(
    '/household/invitations/:id',
    { preHandler: app.requireOwner, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const { householdId } = currentUser(request);
      await db
        .update(householdInvitations)
        .set({ revokedAt: new Date() })
        .where(and(eq(householdInvitations.id, request.params.id), eq(householdInvitations.householdId, householdId)));
      return reply.status(204).send();
    },
  );

  const tokenParams = z.object({ token: z.string().min(10).max(200) });

  const findValidInvitation = async (token: string) => {
    const [row] = await db
      .select({
        invitation: householdInvitations,
        householdName: households.name,
        invitedByName: users.name,
      })
      .from(householdInvitations)
      .innerJoin(households, eq(households.id, householdInvitations.householdId))
      .innerJoin(users, eq(users.id, householdInvitations.invitedBy))
      .where(eq(householdInvitations.tokenHash, hashToken(token)));
    const inv = row?.invitation;
    if (!row || !inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) {
      throw notFound('Invitación inválida o expirada');
    }
    return row;
  };

  app.get('/invitations/:token', { schema: { params: tokenParams } }, async (request) => {
    const { invitation, householdName, invitedByName } = await findValidInvitation(request.params.token);
    const existing = await findUserByEmail(db, invitation.email);
    const [member] = invitation.memberId
      ? await db.select({ name: users.name }).from(users).where(eq(users.id, invitation.memberId))
      : [];
    return {
      memberName: member?.name ?? null,
      email: invitation.email,
      role: invitation.role,
      householdName,
      invitedByName,
      hasAccount: Boolean(existing),
    };
  });

  app.post(
    '/invitations/:token/accept',
    { schema: { params: tokenParams, body: acceptInvitationSchema.nullish() } },
    async (request, reply) => {
      const { invitation } = await findValidInvitation(request.params.token);
      const existing = await findUserByEmail(db, invitation.email);
      const target = { householdId: invitation.householdId, role: invitation.role };

      if (existing) {
        // Existing account: must be logged in as the invited email; switches household.
        if (!request.user) throw unauthorized('Inicia sesión con la cuenta invitada para aceptar');
        if (request.user.id !== existing.id) throw forbidden('Esta invitación es para otra cuenta');
        const result = await db.transaction(async (tx) => {
          const moved =
            existing.householdId === invitation.householdId
              ? { householdId: existing.householdId, role: existing.role, moved: {} }
              : await moveUser(tx, existing.id, target, existing.id);
          // Taking over a member without an account: everything it had becomes this user's.
          if (invitation.memberId) await mergeManagedMember(tx, invitation.memberId, existing.id);
          await tx
            .update(householdInvitations)
            .set({ acceptedAt: new Date() })
            .where(eq(householdInvitations.id, invitation.id));
          return moved;
        });
        return result;
      }

      const { name, password, defaultCurrency } = request.body ?? {};
      if (invitation.memberId) {
        // New account taking over a member without one: the same user row becomes a login.
        if (!password) throw badRequest('La contraseña es requerida para crear la cuenta');
        const passwordHash = await hashPassword(password);
        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({
              email: invitation.email,
              passwordHash,
              accountStatus: 'active',
              ...(name ? { name } : {}),
              ...(defaultCurrency ? { defaultCurrency } : {}),
            })
            .where(eq(users.id, invitation.memberId!));
          await tx.update(householdInvitations).set({ acceptedAt: new Date() }).where(eq(householdInvitations.id, invitation.id));
        });
        await app.startSession(reply, invitation.memberId);
        return reply.status(201).send({ householdId: invitation.householdId, role: invitation.role });
      }
      if (!name || !password) throw badRequest('Nombre y contraseña son requeridos para crear la cuenta');
      const passwordHash = await hashPassword(password);
      const userId = await db.transaction(async (tx) => {
        const [household] = await tx.select().from(households).where(eq(households.id, invitation.householdId));
        const [user] = await tx
          .insert(users)
          .values({
            email: invitation.email,
            name,
            passwordHash,
            defaultCurrency: defaultCurrency ?? household!.baseCurrency,
            householdId: invitation.householdId,
            role: invitation.role,
          })
          .returning({ id: users.id });
        await openMembership(tx, user!.id, invitation.householdId, invitation.role);
        await tx
          .update(householdInvitations)
          .set({ acceptedAt: new Date() })
          .where(eq(householdInvitations.id, invitation.id));
        return user!.id;
      });
      await app.startSession(reply, userId);
      return reply.status(201).send({ householdId: invitation.householdId, role: invitation.role });
    },
  );
};
