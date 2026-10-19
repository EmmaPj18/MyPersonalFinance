import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { emailConnections, households, users } from '../../db/schema';
import { addDays, toIsoDate } from '../../lib/dates';
import { decryptSecret } from '../../lib/secrets';
import type { AuthUser } from '../../plugins/auth';
import { fetchBankEmails, imapError, type BankEmailFetcher } from './imap';
import { importBankEmails, type EmailImportResult } from './inbox';
import { readEmail } from './text';

type Connection = typeof emailConnections.$inferSelect;

/** The owner of a mailbox as the user the transactions are added for. */
const ownerOf = async (db: DbOrTx, userId: string): Promise<AuthUser | null> => {
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
    .from(users)
    .innerJoin(households, eq(households.id, users.householdId))
    .where(eq(users.id, userId));
  if (!row?.email || row.role === 'viewer') return null;
  return { ...row, email: row.email, managedMemberIds: [] };
};

/**
 * Reads the bank emails received since the last sync (2 days back, in case some arrived late;
 * repeated ones are skipped) and adds their transactions to the household inbox.
 */
export const syncConnection = async (
  db: DbOrTx,
  connection: Connection,
  secret: string,
  fetcher: BankEmailFetcher = fetchBankEmails,
): Promise<EmailImportResult> => {
  const user = await ownerOf(db, connection.userId);
  if (!user) throw new Error('El dueño del correo no puede registrar movimientos');
  const from = connection.lastSyncedAt ? addDays(toIsoDate(connection.lastSyncedAt), -2) : connection.sinceDate;
  const since = from < connection.sinceDate ? connection.sinceDate : from;
  const startedAt = new Date();
  const raw = await fetcher(
    { host: connection.host, port: connection.port, username: connection.username, password: decryptSecret(connection.passwordEnc, secret), mailbox: connection.mailbox },
    new Date(`${since}T00:00:00Z`),
  );
  const emails = (await Promise.all(raw.map((r) => readEmail(r)))).filter((e) => e.receivedAt.slice(0, 10) >= connection.sinceDate);
  const result = await importBankEmails(db, user, emails);
  await db.update(emailConnections).set({ lastSyncedAt: startedAt, lastError: null }).where(eq(emailConnections.id, connection.id));
  return result;
};

/** Keeps the reason of a failed sync to show it (outside the failed sync's transaction). */
export const recordSyncError = (db: DbOrTx, connectionId: string, err: unknown) =>
  db.update(emailConnections).set({ lastError: imapError(err) }).where(eq(emailConnections.id, connectionId));

/** Scheduled job: syncs every active mailbox; one failing doesn't stop the others. */
export const runEmailSync = async (db: DbOrTx, secret: string, fetcher?: BankEmailFetcher) => {
  const connections = await db.select().from(emailConnections).where(eq(emailConnections.active, true));
  let added = 0;
  let failed = 0;
  for (const connection of connections) {
    try {
      // A savepoint per mailbox: a failure only rolls back its own changes.
      added += (await db.transaction((tx) => syncConnection(tx, connection, secret, fetcher))).added;
    } catch (err) {
      failed++;
      await recordSyncError(db, connection.id, err);
    }
  }
  return { connections: connections.length, added, failed };
};
