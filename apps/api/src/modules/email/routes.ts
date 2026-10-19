import { emailConnectionInputSchema, emailConnectionUpdateSchema, idParamsSchema } from '@mypersonalfinance/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { emailConnections } from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { encryptSecret } from '../../lib/secrets';
import { currentUser, type AuthUser } from '../../plugins/auth';
import { BANKS } from './banks';
import { imapError, type MailboxSettings } from './imap';
import { importBankEmails } from './inbox';
import { recordSyncError, syncConnection } from './sync';
import { readEmail, type EmailContent } from './text';

type Connection = typeof emailConnections.$inferSelect;

/** Never sends the password back. */
const publicView = ({ passwordEnc: _p, ...c }: Connection) => c;

export const emailRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, config } = app;

  const verify = async (settings: MailboxSettings) => {
    try {
      await app.mailbox.verify(settings);
    } catch (err) {
      throw badRequest(imapError(err));
    }
  };

  /** Mailboxes are personal: only their owner sees and manages them. */
  const findOwn = async (user: AuthUser, id: string) => {
    const [row] = await db
      .select()
      .from(emailConnections)
      .where(and(eq(emailConnections.id, id), eq(emailConnections.userId, user.id)));
    if (!row) throw notFound('Conexión no encontrada');
    return row;
  };

  app.get('/email-connections', { preHandler: app.authenticate }, async (request) => {
    const user = currentUser(request);
    const rows = await db.select().from(emailConnections).where(eq(emailConnections.userId, user.id)).orderBy(desc(emailConnections.createdAt));
    return { connections: rows.map(publicView), banks: Object.values(BANKS).map((b) => b.name) };
  });

  app.post('/email-connections', { preHandler: app.requireWriter, schema: { body: emailConnectionInputSchema } }, async (request, reply) => {
    const user = currentUser(request);
    const { password, ...input } = request.body;
    await verify({ ...input, password });
    const [row] = await db
      .insert(emailConnections)
      .values({ ...input, userId: user.id, passwordEnc: encryptSecret(password, config.SESSION_SECRET) })
      .returning();
    return reply.status(201).send(publicView(row!));
  });

  app.patch(
    '/email-connections/:id',
    { preHandler: app.requireWriter, schema: { params: idParamsSchema, body: emailConnectionUpdateSchema } },
    async (request) => {
      const user = currentUser(request);
      const existing = await findOwn(user, request.params.id);
      const { password, ...input } = request.body;
      if (password || input.mailbox) {
        await verify({ host: existing.host, port: existing.port, username: existing.username, mailbox: input.mailbox ?? existing.mailbox, password: password ?? '' });
      }
      const [row] = await db
        .update(emailConnections)
        .set({
          ...input,
          ...(password ? { passwordEnc: encryptSecret(password, config.SESSION_SECRET), lastError: null } : {}),
          // A new start date reads the mailbox again from it.
          ...(input.sinceDate && input.sinceDate !== existing.sinceDate ? { lastSyncedAt: null } : {}),
        })
        .where(eq(emailConnections.id, existing.id))
        .returning();
      return publicView(row!);
    },
  );

  app.delete('/email-connections/:id', { preHandler: app.requireWriter, schema: { params: idParamsSchema } }, async (request, reply) => {
    const user = currentUser(request);
    const existing = await findOwn(user, request.params.id);
    await db.delete(emailConnections).where(eq(emailConnections.id, existing.id));
    return reply.status(204).send();
  });

  /** Reads the mailbox now. */
  app.post('/email-connections/:id/sync', { preHandler: app.requireWriter, schema: { params: idParamsSchema } }, async (request) => {
    const user = currentUser(request);
    const existing = await findOwn(user, request.params.id);
    try {
      return await db.transaction((tx) => syncConnection(tx, existing, config.SESSION_SECRET, app.mailbox.fetch));
    } catch (err) {
      await recordSyncError(db, existing.id, err);
      throw badRequest(imapError(err));
    }
  });

  /** Bank notifications saved as .eml files, straight to the review inbox. */
  app.post('/import/email', { preHandler: app.requireWriter }, async (request) => {
    const user = currentUser(request);
    const emails: EmailContent[] = [];
    for await (const file of request.files()) {
      if (!/\.eml$/i.test(file.filename)) throw badRequest(`"${file.filename}" no es un correo (.eml)`);
      emails.push(await readEmail(await file.toBuffer()));
    }
    if (emails.length === 0) throw badRequest('Adjunta al menos un correo (.eml)');
    return db.transaction((tx) => importBankEmails(tx, user, emails));
  });
};
