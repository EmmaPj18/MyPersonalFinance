import { ImapFlow } from 'imapflow';
import { BANK_DOMAINS } from './banks';

export interface MailboxSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  mailbox: string;
}

/** Most bank emails we read in one sync; the rest come in the next ones. */
const MAX_MESSAGES = 300;

const clientFor = (s: MailboxSettings) =>
  new ImapFlow({
    host: s.host,
    port: s.port,
    secure: s.port === 993,
    auth: { user: s.username, pass: s.password },
    logger: false,
    socketTimeout: 60_000,
  });

/** Readable reason for a failed connection. */
export const imapError = (err: unknown) => {
  const e = err as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  if (e.authenticationFailed) return 'Usuario o contraseña incorrectos (en Gmail usa una contraseña de aplicación)';
  if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') return `No se pudo conectar al servidor (${e.code})`;
  return e.responseText ?? e.message ?? 'Error de conexión';
};

/** Fetches the raw bank emails received since a date. */
export type BankEmailFetcher = (settings: MailboxSettings, since: Date) => Promise<Buffer[]>;

export const fetchBankEmails: BankEmailFetcher = async (settings, since) => {
  const client = clientFor(settings);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(settings.mailbox);
    try {
      const uids = await client.search({ since, or: BANK_DOMAINS.map((from) => ({ from })) }, { uid: true });
      if (!uids || uids.length === 0) return [];
      const messages = await client.fetchAll(uids.slice(-MAX_MESSAGES), { source: true }, { uid: true });
      return messages.flatMap((m) => (m.source ? [m.source] : []));
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
};

/** Checks the credentials and the mailbox. */
export type MailboxVerifier = (settings: MailboxSettings) => Promise<void>;

export const verifyMailbox: MailboxVerifier = async (settings) => {
  const client = clientFor(settings);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(settings.mailbox);
    lock.release();
  } finally {
    await client.logout().catch(() => undefined);
  }
};
