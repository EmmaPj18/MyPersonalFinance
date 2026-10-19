import type { Currency, Direction } from '@mypersonalfinance/shared';
import { and, between, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { accounts, accountTransfers, transactionInbox, users } from '../../db/schema';
import { addDays } from '../../lib/dates';
import type { AuthUser } from '../../plugins/auth';
import { normalizeText } from '../import/normalize';
import { addToInbox, refundCandidates, type IncomingTransaction } from '../import/service';
import { BANKS, parseBankEmail, type ParsedBankEmail } from './banks';
import type { EmailContent } from './text';

type Account = typeof accounts.$inferSelect;

const DEBITS = new Set(['purchase', 'withdrawal', 'transfer_out']);

/** Tokens an account is known by in bank emails: last digits and bank names. */
const tokensOf = (account: Account) =>
  (account.identifiers ?? '')
    .split(/[,;\s]+/)
    .map((t) => normalizeText(t))
    .filter(Boolean);

/** Our account for some last digits (or the bank, for banks that don't print them), same currency first. */
const findAccount = (accs: Account[], digits: string | null | undefined, bank: string | null, currency: Currency | null) => {
  const bankTokens = bank ? [bank, ...normalizeText(BANKS[bank as keyof typeof BANKS].name).split(' ')] : [];
  const matches = accs.filter((a) => {
    const tokens = tokensOf(a);
    return digits ? tokens.includes(digits) : bankTokens.some((t) => t.length > 3 && tokens.includes(t));
  });
  return matches.find((a) => a.currency === currency) ?? matches[0] ?? null;
};

/** Whether a name ("JUAN PEREZ GOMEZ") is one of the household members ("Juan Perez"). */
const isMemberName = (memberNames: string[][], name: string | null | undefined) => {
  if (!name) return false;
  const words = new Set(normalizeText(name).split(' '));
  return memberNames.some((member) => member.length >= 2 && member.every((w) => words.has(w)));
};

/** The other side of a transfer between our accounts that is already known (in the inbox or registered). */
const knownOtherSide = async (db: DbOrTx, householdId: string, accountId: string, amount: string, currency: Currency, date: string) => {
  const window = between(transactionInbox.date, addDays(date, -3), addDays(date, 3));
  const [inInbox] = await db
    .select({ id: transactionInbox.id })
    .from(transactionInbox)
    .where(
      and(
        eq(transactionInbox.householdId, householdId),
        eq(transactionInbox.kind, 'transfer'),
        eq(transactionInbox.transferAccountId, accountId),
        eq(transactionInbox.amount, amount),
        eq(transactionInbox.currency, currency),
        window,
      ),
    )
    .limit(1);
  if (inInbox) return true;
  const [registered] = await db
    .select({ id: accountTransfers.id })
    .from(accountTransfers)
    .where(
      and(
        eq(accountTransfers.householdId, householdId),
        eq(accountTransfers.toAccountId, accountId),
        eq(accountTransfers.amount, amount),
        between(accountTransfers.date, addDays(date, -3), addDays(date, 3)),
      ),
    )
    .limit(1);
  return Boolean(registered);
};

export interface EmailImportResult {
  /** Bank notifications read. */
  recognized: number;
  added: number;
  duplicates: number;
  /** Emails that aren't transactions we can read (promotions, other senders…). */
  skipped: { subject: string; from: string }[];
}

/**
 * Turns bank notifications into inbox transactions: matches our account by its last digits,
 * proposes transfers between our own accounts (and ignores the receiving side when the sending
 * one is known), and adds bank fees as a separate expense. Unmatched transactions belong to `user`.
 */
export const importBankEmails = async (db: DbOrTx, user: AuthUser, emails: EmailContent[]): Promise<EmailImportResult> => {
  const hid = user.householdId;
  const accs = (await db.select().from(accounts).where(eq(accounts.householdId, hid))).filter((a) => !a.archived);
  const memberNames = (await db.select({ name: users.name }).from(users).where(eq(users.householdId, hid))).map((m) =>
    normalizeText(m.name).split(' ').filter(Boolean),
  );
  const parsed: { email: EmailContent; tx: ParsedBankEmail }[] = [];
  const skipped: EmailImportResult['skipped'] = [];
  for (const email of emails) {
    const tx = parseBankEmail(email);
    if (tx) parsed.push({ email, tx });
    else skipped.push({ subject: email.subject, from: email.from });
  }
  // Money leaving first, so the receiving side of our own transfers can be recognized.
  parsed.sort((a, b) => a.tx.date.localeCompare(b.tx.date) || Number(DEBITS.has(b.tx.type)) - Number(DEBITS.has(a.tx.type)));

  const items: IncomingTransaction[] = [];
  for (const { email, tx } of parsed) {
    const account = findAccount(accs, tx.last4, tx.last4 ? null : tx.bank, tx.currency);
    const currency = tx.currency ?? account?.currency ?? 'DOP';
    const direction: Direction = DEBITS.has(tx.type) ? 'debit' : 'credit';
    const counterpart = tx.counterpartLast4 ? findAccount(accs, tx.counterpartLast4, null, currency) : null;
    // Money between our own accounts, even when we don't know which one is on the other side.
    const own = Boolean(counterpart) || tx.ownTransfer === true || isMemberName(memberNames, tx.counterpartName);
    const owner = account ? account.ownerUserId : user.id;
    const ownership = owner ? { scope: 'personal' as const, ownerUserId: owner } : { scope: 'shared' as const, ownerUserId: null };
    let suggestion: IncomingTransaction['suggestion'] = ownership;

    if (tx.type === 'refund') {
      const [purchase] = await refundCandidates(db, hid, { description: tx.description, currency, date: tx.date, amount: tx.amount, accountId: account?.id ?? null });
      suggestion = { ...ownership, kind: 'refund', refundExpenseId: purchase?.id ?? null };
    } else if (tx.type === 'withdrawal') {
      const cash = accs.find((a) => a.type === 'cash' && a.currency === currency);
      if (cash) suggestion = { ...ownership, kind: 'transfer', transferAccountId: cash.id };
    } else if (tx.type === 'transfer_out' && own && !counterpart) {
      suggestion = { ...ownership, kind: 'transfer', transferAccountId: null };
    } else if (tx.type === 'transfer_out' && counterpart && counterpart.id !== account?.id) {
      suggestion = { ...ownership, kind: 'transfer', transferAccountId: counterpart.id };
      // The receiving side may have arrived first: it isn't income.
      await db
        .update(transactionInbox)
        .set({ kind: 'ignore' })
        .where(
          and(
            eq(transactionInbox.householdId, hid),
            eq(transactionInbox.status, 'pending'),
            eq(transactionInbox.accountId, counterpart.id),
            eq(transactionInbox.direction, 'credit'),
            eq(transactionInbox.amount, tx.amount),
            eq(transactionInbox.currency, currency),
            between(transactionInbox.date, addDays(tx.date, -3), addDays(tx.date, 3)),
          ),
        );
    } else if ((tx.type === 'transfer_in' || tx.type === 'card_payment') && account) {
      const sentFromUs =
        items.some(
          (i) =>
            i.suggestion?.kind === 'transfer' &&
            i.suggestion.transferAccountId === account.id &&
            i.amount === tx.amount &&
            i.currency === currency &&
            Math.abs(Date.parse(i.date) - Date.parse(tx.date)) <= 3 * 86_400_000,
        ) || (await knownOtherSide(db, hid, account.id, tx.amount, currency, tx.date));
      if (sentFromUs) suggestion = { ...ownership, kind: 'ignore' };
      else if (tx.type === 'card_payment' || own) suggestion = { ...ownership, kind: 'transfer', transferAccountId: null };
    }

    const base = { date: tx.date, currency, accountId: account?.id ?? null, raw: { bank: tx.bank, type: tx.type, subject: email.subject } };
    items.push({ ...base, externalRef: email.messageId.slice(0, 255), dedupeKey: email.messageId, description: tx.description.slice(0, 255), amount: tx.amount, direction, suggestion });
    if (tx.fees) {
      items.push({
        ...base,
        externalRef: email.messageId.slice(0, 255),
        dedupeKey: `${email.messageId}#fees`,
        description: `Comisión e impuestos ${BANKS[tx.bank].name}`,
        amount: tx.fees,
        direction: 'debit',
        suggestion: ownership,
      });
    }
  }

  const result = await addToInbox(db, user, 'email', null, items);
  return { recognized: parsed.length, ...result, skipped };
};
