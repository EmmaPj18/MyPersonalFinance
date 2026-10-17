import {
  categorizationRuleInputSchema,
  idParamsSchema,
  importBatchInputSchema,
  inboxCommitSchema,
  inboxIgnoreSchema,
} from '@mypersonalfinance/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  accounts,
  categories,
  categorizationRules,
  importBatches,
  importProfiles,
  incomeSources,
  transactionInbox,
} from '../../db/schema';
import { assertInHousehold, assertOwners } from '../../lib/access';
import { badRequest, notFound } from '../../lib/errors';
import { currentUser } from '../../plugins/auth';
import { parseUpload, templateCsv, templateXlsx } from './files';
import { normalizeRows, normalizeText, suggestMapping } from './normalize';
import { addToInbox, commitInbox, reapplyRules } from './service';

export const importRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  /** Reads an uploaded .xlsx/.csv and returns its rows plus a suggested column mapping. */
  app.post('/import/parse', { preHandler: app.requireWriter }, async (request) => {
    const file = await request.file();
    if (!file) throw badRequest('Adjunta un archivo');
    const parsed = await parseUpload(file.filename, await file.toBuffer());
    const user = currentUser(request);
    const profiles = await db.select().from(importProfiles).where(eq(importProfiles.householdId, user.householdId));
    // A saved profile whose columns all exist in this file is the best guess.
    const profile = profiles.find((p) =>
      Object.values((p.mapping as { columns: Record<string, string> }).columns).every((col) => parsed.headers.includes(col)),
    );
    return {
      fileName: file.filename,
      ...parsed,
      suggested: profile ? (profile.mapping as object) : { columns: suggestMapping(parsed.headers), amountSign: 'negative-is-debit', dateFormat: 'auto' },
      profileName: profile?.name ?? null,
    };
  });

  /** Applies the mapping; with dryRun returns a preview, otherwise adds the rows to the inbox. */
  app.post('/import/batches', { preHandler: app.requireWriter, schema: { body: importBatchInputSchema } }, async (request) => {
    const user = currentUser(request);
    const input = request.body;
    const c = input.mapping.columns;
    if (!c.date) throw badRequest('Indica la columna de fecha');
    if (!c.amount && !c.debit && !c.credit) throw badRequest('Indica la columna de monto (o débito/crédito)');
    await assertInHousehold(db, accounts, input.accountId, user.householdId, 'cuenta');
    const { items, errors } = normalizeRows(input.rows, input.mapping, input.currency);
    if (input.dryRun) return { preview: items.slice(0, 20), total: items.length, errors };

    return db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(importBatches)
        .values({ householdId: user.householdId, source: input.source, fileName: input.fileName ?? null, rowCount: items.length, createdBy: user.id })
        .returning({ id: importBatches.id });
      const result = await addToInbox(
        tx,
        user,
        input.source,
        batch!.id,
        items.map(({ row, ...item }) => ({ ...item, externalRef: `${input.fileName ?? 'archivo'}#${row}`, accountId: input.accountId ?? null })),
      );
      if (input.saveProfileAs) {
        // Profile names are unique ignoring case: update the existing one if any.
        const existing = (await tx.select().from(importProfiles).where(eq(importProfiles.householdId, user.householdId))).find(
          (p) => normalizeText(p.name) === normalizeText(input.saveProfileAs!),
        );
        if (existing) await tx.update(importProfiles).set({ mapping: input.mapping }).where(eq(importProfiles.id, existing.id));
        else await tx.insert(importProfiles).values({ householdId: user.householdId, name: input.saveProfileAs, mapping: input.mapping });
      }
      return { ...result, errors, total: items.length };
    });
  });

  app.get('/import/profiles', { preHandler: app.authenticate }, async (request) =>
    db.select().from(importProfiles).where(eq(importProfiles.householdId, currentUser(request).householdId)).orderBy(importProfiles.name),
  );

  app.delete('/import/profiles/:id', { preHandler: app.requireWriter, schema: { params: idParamsSchema } }, async (request, reply) => {
    await db
      .delete(importProfiles)
      .where(and(eq(importProfiles.id, request.params.id), eq(importProfiles.householdId, currentUser(request).householdId)));
    return reply.status(204).send();
  });

  app.get('/import/template.csv', async (_request, reply) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="plantilla-gastos.csv"')
      .send(templateCsv()),
  );

  app.get('/import/template.xlsx', async (_request, reply) =>
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', 'attachment; filename="plantilla-gastos.xlsx"')
      .send(await templateXlsx()),
  );

  // ------------------------------------------------------------ review inbox

  app.get(
    '/inbox',
    { preHandler: app.authenticate, schema: { querystring: z.object({ status: z.enum(['pending', 'imported', 'ignored']).default('pending') }) } },
    async (request) => {
      const user = currentUser(request);
      return db
        .select()
        .from(transactionInbox)
        .where(and(eq(transactionInbox.householdId, user.householdId), eq(transactionInbox.status, request.query.status)))
        .orderBy(desc(transactionInbox.date), desc(transactionInbox.createdAt))
        .limit(1000);
    },
  );

  app.post('/inbox/commit', { preHandler: app.requireWriter, schema: { body: inboxCommitSchema } }, async (request) => {
    const user = currentUser(request);
    const result = await db.transaction((tx) => commitInbox(tx, user, request.body.items, request.body.remember));
    // New rules classify what's still waiting for review.
    if (request.body.remember) await reapplyRules(db, user.householdId);
    return result;
  });

  app.post('/inbox/ignore', { preHandler: app.requireWriter, schema: { body: inboxIgnoreSchema } }, async (request) => {
    const user = currentUser(request);
    const rows = await db
      .update(transactionInbox)
      .set({ status: 'ignored', kind: 'ignore' })
      .where(
        and(
          eq(transactionInbox.householdId, user.householdId),
          eq(transactionInbox.status, 'pending'),
          inArray(transactionInbox.id, request.body.ids),
        ),
      )
      .returning({ id: transactionInbox.id });
    return { ignored: rows.length };
  });

  /** Sends ignored/imported-by-mistake transactions back to review (deleting nothing created). */
  app.post('/inbox/:id/restore', { preHandler: app.requireWriter, schema: { params: idParamsSchema } }, async (request) => {
    const user = currentUser(request);
    const [row] = await db
      .update(transactionInbox)
      .set({ status: 'pending' })
      .where(and(eq(transactionInbox.id, request.params.id), eq(transactionInbox.householdId, user.householdId), eq(transactionInbox.status, 'ignored')))
      .returning({ id: transactionInbox.id });
    if (!row) throw notFound('Solo se pueden recuperar transacciones ignoradas');
    return row;
  });

  // ------------------------------------------------------------ categorization rules

  app.get('/categorization-rules', { preHandler: app.authenticate }, async (request) =>
    db
      .select()
      .from(categorizationRules)
      .where(eq(categorizationRules.householdId, currentUser(request).householdId))
      .orderBy(categorizationRules.pattern),
  );

  const validateRule = async (householdId: string, input: typeof categorizationRuleInputSchema._output) => {
    await assertInHousehold(db, categories, input.categoryId, householdId, 'categoría');
    await assertInHousehold(db, incomeSources, input.incomeSourceId, householdId, 'fuente de ingreso');
    await assertInHousehold(db, accounts, input.transferAccountId, householdId, 'cuenta');
    const ownerUserId = input.kind === 'expense' && input.scope === 'personal' ? (input.ownerUserId ?? null) : null;
    await assertOwners(db, householdId, [ownerUserId]);
    return { ...input, pattern: normalizeText(input.pattern), scope: ownerUserId ? input.scope : 'shared', ownerUserId } as const;
  };

  app.post('/categorization-rules', { preHandler: app.requireWriter, schema: { body: categorizationRuleInputSchema } }, async (request, reply) => {
    const user = currentUser(request);
    const values = await validateRule(user.householdId, request.body);
    const [row] = await db.insert(categorizationRules).values({ ...values, householdId: user.householdId }).returning();
    await reapplyRules(db, user.householdId);
    return reply.status(201).send(row);
  });

  app.put(
    '/categorization-rules/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: categorizationRuleInputSchema } },
    async (request) => {
      const user = currentUser(request);
      const values = await validateRule(user.householdId, request.body);
      const [row] = await db
        .update(categorizationRules)
        .set(values)
        .where(and(eq(categorizationRules.id, request.params.id), eq(categorizationRules.householdId, user.householdId)))
        .returning();
      if (!row) throw notFound('Regla no encontrada');
      await reapplyRules(db, user.householdId);
      return row;
    },
  );

  app.delete('/categorization-rules/:id', { preHandler: app.requireWriter, schema: { params: idParamsSchema } }, async (request, reply) => {
    await db
      .delete(categorizationRules)
      .where(and(eq(categorizationRules.id, request.params.id), eq(categorizationRules.householdId, currentUser(request).householdId)));
    return reply.status(204).send();
  });
};
