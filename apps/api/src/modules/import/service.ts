import { createHash } from 'node:crypto';
import type { Currency, Direction, InboxCommitItem, InboxKind, InboxSource, Scope } from '@mypersonalfinance/shared';
import Decimal from 'decimal.js';
import { and, between, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../../db/client';
import {
  accounts,
  accountTransfers,
  categories,
  categorizationRules,
  expenses,
  incomeEntries,
  incomeSources,
  transactionInbox,
  users,
} from '../../db/schema';
import { assertCanEdit, assertOwners, resolveSplits } from '../../lib/access';
import { addDays } from '../../lib/dates';
import { badRequest } from '../../lib/errors';
import type { AuthUser } from '../../plugins/auth';
import { writeAudit } from '../../lib/audit';
import { currentSplits, writeSplits } from '../expenses/service';
import { writeEntryChildren } from '../income/service';
import { normalizeText } from './normalize';

/** A transaction read from a file or an email, before review. */
export interface IncomingTransaction {
  externalRef: string;
  date: string;
  description: string;
  amount: string;
  currency: Currency;
  direction: Direction;
  accountId: string | null;
  /** Optional hints (our template columns). */
  category?: string;
  owner?: string;
  account?: string;
  raw?: unknown;
  /** Unique id at the source (email message): dedupes instead of the content, so two equal purchases aren't merged. */
  dedupeKey?: string;
  /** Classification proposed by the source. Transfers and ignores win over the rules; the rest, only without a rule. */
  suggestion?: { kind?: InboxKind; transferAccountId?: string | null; refundExpenseId?: string | null; scope?: Scope; ownerUserId?: string | null };
}

type Rule = typeof categorizationRules.$inferSelect;

/** Pattern stored for a remembered description: normalized text without numbers (dates, references…). */
export const patternFor = (description: string) =>
  normalizeText(description.replace(/[\d#*/:.,\-]+/g, ' ')).slice(0, 120);

export const matchRule = (rules: Rule[], description: string) => {
  const text = normalizeText(description);
  // Longest pattern first: the most specific rule wins.
  return [...rules].sort((a, b) => b.pattern.length - a.pattern.length).find((r) => r.pattern && text.includes(r.pattern)) ?? null;
};

/** How far back a refund looks for its purchase. */
const REFUND_WINDOW_DAYS = 120;

/**
 * Purchases a refund may belong to: same currency, on or before its date, at least its amount,
 * of the same merchant (or the same account and exact amount). Most recent first.
 */
export const refundCandidates = async (
  db: DbOrTx,
  householdId: string,
  refund: { description: string; currency: Currency; date: string; amount: string; accountId: string | null },
) => {
  const rows = await db
    .select({ id: expenses.id, description: expenses.description, date: expenses.date, amount: expenses.amount, accountId: expenses.accountId })
    .from(expenses)
    .where(
      and(
        eq(expenses.householdId, householdId),
        eq(expenses.currency, refund.currency),
        between(expenses.date, addDays(refund.date, -REFUND_WINDOW_DAYS), refund.date),
        sql`${expenses.amount} >= ${refund.amount}`,
      ),
    )
    .orderBy(desc(expenses.date))
    .limit(500);
  const merchant = patternFor(refund.description);
  return rows.filter((e) => {
    const other = patternFor(e.description);
    const sameMerchant = merchant.length >= 3 && (other.includes(merchant) || merchant.includes(other)) && other.length >= 3;
    return sameMerchant || (refund.accountId && e.accountId === refund.accountId && e.amount === refund.amount);
  });
};

const hashOf = (householdId: string, t: IncomingTransaction) =>
  createHash('sha256')
    .update(
      t.dedupeKey
        ? [householdId, t.dedupeKey].join('|')
        : [householdId, t.accountId ?? '', t.date, t.amount, t.currency, t.direction, normalizeText(t.description)].join('|'),
    )
    .digest('hex');

/**
 * Adds transactions to the review inbox, suggesting a classification from the rules and the
 * file's own columns, flagging likely duplicates of existing expenses, and skipping
 * transactions already in the inbox.
 */
export const addToInbox = async (
  db: DbOrTx,
  user: AuthUser,
  source: InboxSource,
  batchId: string | null,
  items: IncomingTransaction[],
) => {
  const hid = user.householdId;
  const [rules, cats, members, accs] = await Promise.all([
    db.select().from(categorizationRules).where(eq(categorizationRules.householdId, hid)),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.householdId, hid)),
    db.select({ id: users.id, name: users.name, status: users.accountStatus }).from(users).where(eq(users.householdId, hid)),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.householdId, hid)),
  ]);
  const byName = <T extends { name: string }>(list: T[], name?: string) =>
    name ? list.find((x) => normalizeText(x.name) === normalizeText(name)) : undefined;

  let added = 0;
  let duplicates = 0;
  for (const t of items) {
    const accountId = t.accountId ?? byName(accs, t.account)?.id ?? null;
    const rule = matchRule(rules, t.description);
    const category = byName(cats, t.category);
    const owner = t.owner && normalizeText(t.owner) !== 'hogar' ? byName(members.filter((m) => m.status === 'active'), t.owner) : undefined;

    const hint = t.suggestion;
    let kind: InboxKind = hint?.kind ?? (t.direction === 'debit' ? 'expense' : 'income');
    let classification: { categoryId?: string | null; incomeSourceId?: string | null; transferAccountId?: string | null; scope: Scope; ownerUserId: string | null } = {
      scope: owner ? 'personal' : (hint?.scope ?? 'shared'),
      ownerUserId: owner?.id ?? (hint?.scope === 'personal' ? (hint.ownerUserId ?? null) : null),
      categoryId: category?.id ?? null,
      transferAccountId: hint?.transferAccountId ?? null,
    };
    const forced = hint?.kind === 'transfer' || hint?.kind === 'ignore' || hint?.kind === 'refund';
    if (rule && !category && !forced) {
      kind = rule.kind;
      classification = {
        categoryId: rule.categoryId,
        incomeSourceId: rule.incomeSourceId,
        transferAccountId: rule.transferAccountId,
        scope: rule.scope,
        ownerUserId: rule.ownerUserId,
      };
    }

    // Same amount and account within 2 days already registered as an expense.
    const [duplicate] =
      t.direction === 'debit'
        ? await db
            .select({ id: expenses.id })
            .from(expenses)
            .where(
              and(
                eq(expenses.householdId, hid),
                eq(expenses.amount, t.amount),
                eq(expenses.currency, t.currency),
                between(expenses.date, addDays(t.date, -2), addDays(t.date, 2)),
                accountId ? eq(expenses.accountId, accountId) : undefined,
              ),
            )
            .limit(1)
        : [];

    const [row] = await db
      .insert(transactionInbox)
      .values({
        householdId: hid,
        source,
        batchId,
        externalRef: t.externalRef,
        dedupeHash: hashOf(hid, t),
        date: t.date,
        description: t.description,
        amount: t.amount,
        currency: t.currency,
        direction: t.direction,
        accountId,
        kind: duplicate ? 'ignore' : kind,
        ...classification,
        ruleId: rule && !category && !forced ? rule.id : null,
        refundExpenseId: kind === 'refund' ? (hint?.refundExpenseId ?? null) : null,
        duplicateOfExpenseId: duplicate?.id ?? null,
        raw: t.raw ?? null,
        createdBy: user.id,
      })
      .onConflictDoNothing()
      .returning({ id: transactionInbox.id });
    if (row) added++;
    else duplicates++;
  }
  return { added, duplicates };
};

type InboxRow = typeof transactionInbox.$inferSelect;

/**
 * Takes a refund off its purchase: the expense keeps the rest, or is removed when the whole
 * amount came back. Returns the expense that remains (null when removed).
 */
const applyRefund = async (tx: Tx, user: AuthUser, row: InboxRow, chosenId: string | null, description: string) => {
  const targetId = chosenId ?? (await refundCandidates(tx, user.householdId, row))[0]?.id;
  if (!targetId) throw badRequest(`No encontré la compra de "${description}": regístrala primero o márcala como Ignorar`);
  const [expense] = await tx.select().from(expenses).where(and(eq(expenses.id, targetId), eq(expenses.householdId, user.householdId)));
  if (!expense) throw badRequest('Compra de la devolución inválida');
  assertCanEdit(user, expense.ownerUserId);
  if (expense.currency !== row.currency) throw badRequest(`La devolución de "${description}" está en ${row.currency} y la compra en ${expense.currency}`);
  const rest = new Decimal(expense.amount).minus(row.amount);
  if (rest.isNegative()) throw badRequest(`La devolución de "${description}" es mayor que la compra elegida`);
  await writeAudit(tx, {
    householdId: user.householdId,
    userId: user.id,
    entity: 'expense',
    entityId: expense.id,
    action: 'refund',
    before: { amount: expense.amount },
    after: { amount: rest.toFixed(2), refund: row.amount, date: row.date, inboxId: row.id },
  });
  if (rest.isZero()) {
    await tx.delete(expenses).where(eq(expenses.id, expense.id));
    return null;
  }
  await tx.update(expenses).set({ amount: rest.toFixed(2) }).where(eq(expenses.id, expense.id));
  if (expense.scope === 'shared') await writeSplits(tx, expense.id, rest.toFixed(2), await currentSplits(tx, expense.id));
  return expense.id;
};

/** Creates the expense / income / transfer of each reviewed transaction (or ignores it). */
export const commitInbox = async (tx: Tx, user: AuthUser, items: InboxCommitItem[], remember: boolean) => {
  const hid = user.householdId;
  const rows = await tx
    .select()
    .from(transactionInbox)
    .where(and(eq(transactionInbox.householdId, hid), eq(transactionInbox.status, 'pending'), inArray(transactionInbox.id, items.map((i) => i.id))));
  if (rows.length !== items.length) throw badRequest('Alguna transacción ya fue procesada o no existe');

  const sources = await tx.select().from(incomeSources).where(eq(incomeSources.householdId, hid));
  const accs = await tx.select().from(accounts).where(eq(accounts.householdId, hid));
  const catIds = new Set((await tx.select({ id: categories.id }).from(categories).where(eq(categories.householdId, hid))).map((c) => c.id));
  const counts = { expense: 0, income: 0, transfer: 0, ignore: 0, refund: 0 };

  // Refunds last: their purchase may be registered in this same batch.
  const ordered = [...items].sort((a, b) => Number(a.kind === 'refund') - Number(b.kind === 'refund'));
  for (const item of ordered) {
    const row = rows.find((r) => r.id === item.id)!;
    const description = item.description ?? row.description;
    const accountId = item.accountId === undefined ? row.accountId : item.accountId;
    if (accountId && !accs.some((a) => a.id === accountId)) throw badRequest('Cuenta inválida');
    const scope: Scope = item.kind === 'expense' ? item.scope ?? 'shared' : 'shared';
    const ownerUserId = item.kind === 'expense' && scope === 'personal' ? (item.ownerUserId ?? user.id) : null;
    const done: Partial<typeof transactionInbox.$inferInsert> = { status: item.kind === 'ignore' ? 'ignored' : 'imported', kind: item.kind };

    if (item.kind === 'expense') {
      if (item.categoryId && !catIds.has(item.categoryId)) throw badRequest('Categoría inválida');
      await assertOwners(tx, hid, [ownerUserId]);
      assertCanEdit(user, ownerUserId);
      const [expense] = await tx
        .insert(expenses)
        .values({
          householdId: hid,
          categoryId: item.categoryId ?? null,
          accountId,
          paidByUserId: ownerUserId ?? user.id,
          amount: row.amount,
          currency: row.currency,
          date: row.date,
          description,
          nature: 'variable',
          scope,
          ownerUserId,
          status: 'paid',
          createdBy: user.id,
        })
        .returning();
      if (scope === 'shared') await writeSplits(tx, expense!.id, expense!.amount, await resolveSplits(tx, hid, undefined));
      done.expenseId = expense!.id;
    } else if (item.kind === 'income') {
      const source = sources.find((s) => s.id === item.incomeSourceId);
      if (!source) throw badRequest(`Elige la fuente de ingreso de "${description}"`);
      assertCanEdit(user, source.ownerUserId);
      const [entry] = await tx
        .insert(incomeEntries)
        .values({
          householdId: hid,
          sourceId: source.id,
          createdBy: user.id,
          kind: source.type === 'freelance' ? 'freelance' : 'other',
          payDate: row.date,
          grossAmount: row.amount,
          netAmount: row.amount,
          currency: row.currency,
          accountId: accountId ?? source.accountId,
          notes: description,
        })
        .returning({ id: incomeEntries.id });
      const splits = source.scope === 'shared' ? await resolveSplits(tx, hid, undefined) : [];
      await writeEntryChildren(tx, entry!.id, [], splits);
      done.incomeEntryId = entry!.id;
    } else if (item.kind === 'transfer') {
      const other = accs.find((a) => a.id === item.transferAccountId);
      if (!other || !accountId) throw badRequest(`Indica la cuenta de origen y destino de "${description}"`);
      // Money leaving the statement's account goes to the other one, and vice versa.
      const [from, to] = row.direction === 'debit' ? [accountId, other.id] : [other.id, accountId];
      const [transfer] = await tx
        .insert(accountTransfers)
        .values({ householdId: hid, fromAccountId: from, toAccountId: to, date: row.date, amount: row.amount, currency: row.currency, description, createdBy: user.id })
        .returning({ id: accountTransfers.id });
      done.transferId = transfer!.id;
    } else if (item.kind === 'refund') {
      done.refundExpenseId = await applyRefund(tx, user, row, item.refundExpenseId ?? null, description);
    }
    counts[item.kind]++;
    await tx
      .update(transactionInbox)
      .set({
        ...done,
        categoryId: item.categoryId ?? null,
        incomeSourceId: item.incomeSourceId ?? null,
        transferAccountId: item.transferAccountId ?? null,
        scope,
        ownerUserId,
      })
      .where(eq(transactionInbox.id, row.id));

    // A rule would turn the merchant's next purchases into refunds.
    if (remember && item.kind !== 'refund') {
      const pattern = patternFor(description);
      if (pattern.length >= 3) {
        const rule = {
          kind: item.kind,
          categoryId: item.kind === 'expense' ? (item.categoryId ?? null) : null,
          incomeSourceId: item.kind === 'income' ? (item.incomeSourceId ?? null) : null,
          transferAccountId: item.kind === 'transfer' ? (item.transferAccountId ?? null) : null,
          scope,
          ownerUserId,
        };
        await tx
          .insert(categorizationRules)
          .values({ householdId: hid, pattern, ...rule })
          .onConflictDoUpdate({ target: [categorizationRules.householdId, categorizationRules.pattern], set: rule });
      }
    }
  }
  return counts;
};

/** Re-applies the rules to pending transactions that have no rule or category yet. */
export const reapplyRules = async (db: DbOrTx, householdId: string) => {
  const rules = await db.select().from(categorizationRules).where(eq(categorizationRules.householdId, householdId));
  const pending = await db
    .select()
    .from(transactionInbox)
    .where(
      and(
        eq(transactionInbox.householdId, householdId),
        eq(transactionInbox.status, 'pending'),
        ne(transactionInbox.kind, 'refund'),
        isNull(transactionInbox.categoryId),
        isNull(transactionInbox.duplicateOfExpenseId),
      ),
    );
  for (const p of pending) {
    const rule = matchRule(rules, p.description);
    if (!rule) continue;
    await db
      .update(transactionInbox)
      .set({ kind: rule.kind, categoryId: rule.categoryId, incomeSourceId: rule.incomeSourceId, transferAccountId: rule.transferAccountId, scope: rule.scope, ownerUserId: rule.ownerUserId, ruleId: rule.id })
      .where(eq(transactionInbox.id, p.id));
  }
};

/** Signed movement of every account from transfers, by account and currency. */
export const transferMovements = (householdId: string) => sql`
  select from_account_id as account_id, currency, -amount as amount from account_transfers where household_id = ${householdId}
  union all
  select t.to_account_id, coalesce(case when t.to_amount is not null then a.currency end, t.currency), coalesce(t.to_amount, t.amount)
  from account_transfers t join accounts a on a.id = t.to_account_id where t.household_id = ${householdId}`;
