import { pctsSumTo100, type Scope, type SplitInput } from '@mypersonalfinance/shared';
import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '../db/client';
import { users } from '../db/schema';
import type { AuthUser } from '../plugins/auth';
import { badRequest, forbidden, notFound } from './errors';

/** Personal records the user manages: their own and those of members without an account. */
const managedBy = (user: AuthUser, ownerUserId: string | null) =>
  ownerUserId === user.id || (ownerUserId !== null && user.managedMemberIds.includes(ownerUserId));

/**
 * Personal records of other members are visible only when the household privacy mode is "open"
 * (records of members without an account are always visible: the household manages them).
 * Returns a condition to AND into queries (undefined = no restriction).
 */
export const visibilityFilter = (user: AuthUser, ownerCol: AnyPgColumn, scopeCol?: AnyPgColumn): SQL | undefined => {
  if (user.privacyMode === 'open') return undefined;
  const owners = [user.id, ...user.managedMemberIds];
  return scopeCol ? or(eq(scopeCol, 'shared'), inArray(ownerCol, owners)) : or(inArray(ownerCol, owners), isNull(ownerCol));
};

export const canSee = (user: AuthUser, ownerUserId: string | null) =>
  user.privacyMode === 'open' || ownerUserId === null || managedBy(user, ownerUserId);

/**
 * Writers may edit shared records, their own personal records and those of members without an
 * account; owners may edit everything. Viewers are blocked earlier by `requireWriter`.
 */
export const assertCanEdit = (user: AuthUser, ownerUserId: string | null) => {
  if (user.role === 'viewer') throw forbidden('Tu rol es de solo lectura');
  if (ownerUserId && !managedBy(user, ownerUserId) && user.role !== 'owner') {
    throw forbidden('Solo el dueño del registro o del hogar puede modificarlo');
  }
};

/** Ensures each user id is a current member of the household. */
export const assertMembers = async (db: DbOrTx, householdId: string, userIds: (string | null | undefined)[]) => {
  const ids = [...new Set(userIds.filter((v): v is string => Boolean(v)))];
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.householdId, householdId), inArray(users.id, ids)));
  if (rows.length !== ids.length) throw badRequest('Alguno de los miembros indicados no pertenece al hogar');
};

/** Ensures each id can own personal records: any current member, with or without an account. */
export const assertOwners = assertMembers;

/** Ensures an optional reference (account, category...) belongs to the household. */
export const assertInHousehold = async (
  db: DbOrTx,
  table: PgTable & { id: AnyPgColumn; householdId: AnyPgColumn },
  id: string | null | undefined,
  householdId: string,
  label = 'registro',
) => {
  if (!id) return;
  const rows = await db
    .select({ id: table.id })
    .from(table as PgTable)
    .where(and(eq(table.id, id), eq(table.householdId, householdId)))
    .limit(1);
  if (rows.length === 0) throw badRequest(`El ${label} indicado no existe en el hogar`);
};

/** Resolves scope/owner coherently: personal => owner (default current user); shared => null. */
export const resolveOwner = (user: AuthUser, scope: Scope, ownerUserId: string | null | undefined) =>
  scope === 'personal' ? (ownerUserId ?? user.id) : null;

/**
 * Resolves the split for a shared record: explicit splits must sum 100%; otherwise uses each
 * member's default split (or an equal split when not configured).
 */
export const resolveSplits = async (
  db: DbOrTx,
  householdId: string,
  splits: SplitInput[] | undefined,
): Promise<SplitInput[]> => {
  if (splits && splits.length > 0) {
    if (!pctsSumTo100(splits.map((s) => s.sharePct))) throw badRequest('El reparto debe sumar 100%');
    if (new Set(splits.map((s) => s.userId)).size !== splits.length) throw badRequest('Miembro repetido en el reparto');
    await assertMembers(db, householdId, splits.map((s) => s.userId));
    return splits;
  }
  const members = await db
    .select({ id: users.id, pct: users.defaultSplitPct })
    .from(users)
    .where(eq(users.householdId, householdId))
    .orderBy(users.createdAt);
  if (members.length === 0) throw notFound('Hogar sin miembros');
  const configured = members.map((m) => Number(m.pct ?? NaN));
  if (configured.every((p) => !Number.isNaN(p)) && pctsSumTo100(configured)) {
    return members.map((m, i) => ({ userId: m.id, sharePct: configured[i]! }));
  }
  // Equal split; the rounding remainder goes to the last member.
  const base = Math.floor((100 / members.length) * 100) / 100;
  return members.map((m, i) => ({
    userId: m.id,
    sharePct: i === members.length - 1 ? Number((100 - base * (members.length - 1)).toFixed(2)) : base,
  }));
};
