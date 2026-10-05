import {
  computeNet,
  idParamsSchema,
  incomeEntryFiltersSchema,
  incomeEntryInputSchema,
  incomeSourceInputSchema,
  isNegative,
} from '@mypersonalfinance/shared';
import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DbOrTx } from '../../db/client';
import {
  accounts,
  deductionTypes,
  incomeDeductions,
  incomeEntries,
  incomeSources,
  incomeSplits,
  sourceDeductionTemplates,
} from '../../db/schema';
import { assertCanEdit, assertInHousehold, assertMembers, resolveOwner, resolveSplits, visibilityFilter } from '../../lib/access';
import { badRequest, notFound } from '../../lib/errors';
import { monthRange } from '../../lib/dates';
import type { AuthUser } from '../../plugins/auth';
import { currentUser } from '../../plugins/auth';

const assertDeductionTypes = async (db: DbOrTx, householdId: string, ids: string[]) => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const rows = await db
    .select({ id: deductionTypes.id })
    .from(deductionTypes)
    .where(and(eq(deductionTypes.householdId, householdId), inArray(deductionTypes.id, unique)));
  if (rows.length !== unique.length) throw badRequest('Tipo de descuento inválido');
};

export const incomeRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  const findSource = async (user: AuthUser, id: string) => {
    const [row] = await db
      .select()
      .from(incomeSources)
      .where(
        and(
          eq(incomeSources.id, id),
          eq(incomeSources.householdId, user.householdId),
          visibilityFilter(user, incomeSources.ownerUserId, incomeSources.scope),
        ),
      );
    if (!row) throw notFound('Fuente de ingreso no encontrada');
    return row;
  };

  // ------------------------------------------------------------ sources

  app.get('/income-sources', { preHandler: app.authenticate }, async (request) => {
    const user = currentUser(request);
    const sources = await db
      .select()
      .from(incomeSources)
      .where(
        and(
          eq(incomeSources.householdId, user.householdId),
          visibilityFilter(user, incomeSources.ownerUserId, incomeSources.scope),
        ),
      )
      .orderBy(incomeSources.name);
    const templates = sources.length
      ? await db
          .select()
          .from(sourceDeductionTemplates)
          .where(inArray(sourceDeductionTemplates.sourceId, sources.map((s) => s.id)))
      : [];
    return sources.map((s) => ({
      ...s,
      deductionTemplates: templates
        .filter((t) => t.sourceId === s.id)
        .map(({ deductionTypeId, defaultAmount }) => ({ deductionTypeId, defaultAmount })),
    }));
  });

  const saveSource = async (user: AuthUser, input: typeof incomeSourceInputSchema._output, id?: string) => {
    const ownerUserId = resolveOwner(user, input.scope, input.ownerUserId);
    await assertMembers(db, user.householdId, [ownerUserId]);
    assertCanEdit(user, ownerUserId);
    await assertInHousehold(db, accounts, input.accountId, user.householdId, 'cuenta');
    const templates = input.deductionTemplates;
    if (templates) await assertDeductionTypes(db, user.householdId, templates.map((t) => t.deductionTypeId));
    const { deductionTemplates: _ignored, ...values } = input;

    return db.transaction(async (tx) => {
      const data = { ...values, ownerUserId, accountId: input.accountId ?? null };
      const [source] = id
        ? await tx.update(incomeSources).set(data).where(eq(incomeSources.id, id)).returning()
        : await tx.insert(incomeSources).values({ ...data, householdId: user.householdId }).returning();
      if (templates) {
        await tx.delete(sourceDeductionTemplates).where(eq(sourceDeductionTemplates.sourceId, source!.id));
        if (templates.length) {
          await tx
            .insert(sourceDeductionTemplates)
            .values(templates.map((t) => ({ sourceId: source!.id, ...t })));
        }
      }
      return source!;
    });
  };

  app.post(
    '/income-sources',
    { preHandler: app.requireWriter, schema: { body: incomeSourceInputSchema } },
    async (request, reply) => reply.status(201).send(await saveSource(currentUser(request), request.body)),
  );

  app.put(
    '/income-sources/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: incomeSourceInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const existing = await findSource(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      return saveSource(user, request.body, existing.id);
    },
  );

  app.delete(
    '/income-sources/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      const existing = await findSource(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      await db.delete(incomeSources).where(eq(incomeSources.id, existing.id));
      return reply.status(204).send();
    },
  );

  // ------------------------------------------------------------ entries

  app.get(
    '/income-entries',
    { preHandler: app.authenticate, schema: { querystring: incomeEntryFiltersSchema } },
    async (request) => {
      const user = currentUser(request);
      const f = request.query;
      const range = f.month ? monthRange(f.month) : { from: f.from, to: f.to };
      const conditions: (SQL | undefined)[] = [
        eq(incomeEntries.householdId, user.householdId),
        visibilityFilter(user, incomeSources.ownerUserId, incomeSources.scope),
        range.from ? gte(incomeEntries.payDate, range.from) : undefined,
        range.to ? lte(incomeEntries.payDate, range.to) : undefined,
        f.sourceId ? eq(incomeEntries.sourceId, f.sourceId) : undefined,
        f.ownerUserId ? eq(incomeSources.ownerUserId, f.ownerUserId) : undefined,
        f.scope ? eq(incomeSources.scope, f.scope) : undefined,
        f.kind ? eq(incomeEntries.kind, f.kind) : undefined,
      ];
      const entries = await db
        .select({
          entry: incomeEntries,
          sourceName: incomeSources.name,
          sourceType: incomeSources.type,
          scope: incomeSources.scope,
          ownerUserId: incomeSources.ownerUserId,
        })
        .from(incomeEntries)
        .innerJoin(incomeSources, eq(incomeSources.id, incomeEntries.sourceId))
        .where(and(...conditions))
        .orderBy(desc(incomeEntries.payDate), desc(incomeEntries.createdAt))
        .limit(1000);
      const ids = entries.map((e) => e.entry.id);
      const [deductions, splits] = ids.length
        ? await Promise.all([
            db
              .select({
                incomeEntryId: incomeDeductions.incomeEntryId,
                deductionTypeId: incomeDeductions.deductionTypeId,
                name: deductionTypes.name,
                category: deductionTypes.category,
                amount: incomeDeductions.amount,
              })
              .from(incomeDeductions)
              .innerJoin(deductionTypes, eq(deductionTypes.id, incomeDeductions.deductionTypeId))
              .where(inArray(incomeDeductions.incomeEntryId, ids)),
            db.select().from(incomeSplits).where(inArray(incomeSplits.incomeEntryId, ids)),
          ])
        : [[], []];
      return entries.map(({ entry, ...source }) => ({
        ...entry,
        ...source,
        deductions: deductions.filter((d) => d.incomeEntryId === entry.id).map(({ incomeEntryId: _, ...d }) => d),
        splits: splits.filter((s) => s.incomeEntryId === entry.id).map(({ userId, sharePct }) => ({ userId, sharePct })),
      }));
    },
  );

  const saveEntry = async (user: AuthUser, input: typeof incomeEntryInputSchema._output, id?: string) => {
    const source = await findSource(user, input.sourceId);
    assertCanEdit(user, source.ownerUserId);
    await assertInHousehold(db, accounts, input.accountId, user.householdId, 'cuenta');
    await assertDeductionTypes(db, user.householdId, input.deductions.map((d) => d.deductionTypeId));
    const netAmount = computeNet(input.grossAmount, input.deductions.map((d) => d.amount));
    if (isNegative(netAmount)) throw badRequest('Los descuentos no pueden superar el monto bruto');
    const splits = source.scope === 'shared' ? await resolveSplits(db, user.householdId, input.splits) : [];

    return db.transaction(async (tx) => {
      const { deductions, splits: _s, ...values } = input;
      const data = { ...values, netAmount, accountId: input.accountId ?? source.accountId ?? null };
      const [entry] = id
        ? await tx.update(incomeEntries).set(data).where(eq(incomeEntries.id, id)).returning()
        : await tx
            .insert(incomeEntries)
            .values({ ...data, householdId: user.householdId, createdBy: user.id })
            .returning();
      await tx.delete(incomeDeductions).where(eq(incomeDeductions.incomeEntryId, entry!.id));
      await tx.delete(incomeSplits).where(eq(incomeSplits.incomeEntryId, entry!.id));
      if (deductions.length) {
        await tx.insert(incomeDeductions).values(deductions.map((d) => ({ incomeEntryId: entry!.id, ...d })));
      }
      if (splits.length) {
        await tx
          .insert(incomeSplits)
          .values(splits.map((s) => ({ incomeEntryId: entry!.id, userId: s.userId, sharePct: String(s.sharePct) })));
      }
      return { ...entry!, deductions, splits };
    });
  };

  const findEntry = async (user: AuthUser, id: string) => {
    const [row] = await db
      .select({ entry: incomeEntries, ownerUserId: incomeSources.ownerUserId })
      .from(incomeEntries)
      .innerJoin(incomeSources, eq(incomeSources.id, incomeEntries.sourceId))
      .where(
        and(
          eq(incomeEntries.id, id),
          eq(incomeEntries.householdId, user.householdId),
          visibilityFilter(user, incomeSources.ownerUserId, incomeSources.scope),
        ),
      );
    if (!row) throw notFound('Ingreso no encontrado');
    return row;
  };

  app.post(
    '/income-entries',
    { preHandler: app.requireWriter, schema: { body: incomeEntryInputSchema } },
    async (request, reply) => reply.status(201).send(await saveEntry(currentUser(request), request.body)),
  );

  app.put(
    '/income-entries/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: incomeEntryInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const existing = await findEntry(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      return saveEntry(user, request.body, existing.entry.id);
    },
  );

  app.delete(
    '/income-entries/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = currentUser(request);
      const existing = await findEntry(user, request.params.id);
      assertCanEdit(user, existing.ownerUserId);
      await db.delete(incomeEntries).where(eq(incomeEntries.id, existing.entry.id));
      return reply.status(204).send();
    },
  );
};
