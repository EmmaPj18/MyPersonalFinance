import type { Currency, Scope } from '@mypersonalfinance/shared';
import Decimal from 'decimal.js';
import type { FxResolver } from '../../lib/fx';
import type { ExpenseRow, IncomeRow, ShareRow } from './data';

export type View = 'household' | 'me';

/** Accumulates converted amounts as Decimals and prints them as money strings. */
class Acc {
  private map = new Map<string, Decimal>();
  add(key: string, value: Decimal.Value) {
    this.map.set(key, (this.map.get(key) ?? new Decimal(0)).plus(value));
  }
  get(key: string) {
    return this.map.get(key) ?? new Decimal(0);
  }
  keys() {
    return [...this.map.keys()];
  }
}

const fmt = (d: Decimal) => d.toFixed(2);

/**
 * How much of a record belongs to the view:
 * - household: everything (1)
 * - me: my personal records (1) and my share of shared records (pct / 100)
 */
export const viewFactor = (
  view: View,
  userId: string,
  record: { scope: Scope; ownerUserId: string | null; splits: ShareRow[] },
): Decimal => {
  if (view === 'household') return new Decimal(1);
  if (record.scope === 'personal') return new Decimal(record.ownerUserId === userId ? 1 : 0);
  const mine = record.splits.find((s) => s.userId === userId);
  return new Decimal(mine?.sharePct ?? 0).div(100);
};

/** Distribution of a record across members (personal => owner 100%; shared => splits). */
export const memberShares = (record: { scope: Scope; ownerUserId: string | null; splits: ShareRow[] }): ShareRow[] =>
  record.scope === 'personal' && record.ownerUserId
    ? [{ userId: record.ownerUserId, sharePct: 100 }]
    : record.splits;

export interface ConvertCtx {
  fx: FxResolver;
  currency: Currency;
  /** Incremented when a record could not be converted (missing rate); such records are skipped. */
  missing: Set<string>;
}

const convert = (ctx: ConvertCtx, id: string, amount: string, from: Currency, date: string): Decimal | null => {
  const value = ctx.fx.convert(amount, from, ctx.currency, date);
  if (value === null) {
    ctx.missing.add(`${from}>${ctx.currency}`);
    return null;
  }
  return new Decimal(value);
};

export const summarizeIncome = (rows: IncomeRow[], ctx: ConvertCtx, view: View, userId: string) => {
  const totals = new Acc();
  const bySource = new Map<string, { sourceId: string; name: string; type: string; scope: Scope; ownerUserId: string | null; acc: Acc }>();
  const byPerson = new Acc();
  const byPersonGross = new Acc();
  const byKind = new Acc();
  const byDeduction = new Map<string, { deductionTypeId: string; name: string; category: string; amount: Decimal }>();

  for (const r of rows) {
    const factor = viewFactor(view, userId, r);
    if (factor.isZero()) continue;
    const gross = convert(ctx, r.id, r.grossAmount, r.currency, r.payDate);
    const net = convert(ctx, r.id, r.netAmount, r.currency, r.payDate);
    if (!gross || !net) continue;
    const g = gross.times(factor);
    const n = net.times(factor);
    totals.add('gross', g);
    totals.add('net', n);
    totals.add('deductions', g.minus(n));
    byKind.add(r.kind, n);

    const src = bySource.get(r.sourceId) ?? {
      sourceId: r.sourceId,
      name: r.sourceName,
      type: r.sourceType,
      scope: r.scope,
      ownerUserId: r.ownerUserId,
      acc: new Acc(),
    };
    src.acc.add('gross', g);
    src.acc.add('net', n);
    src.acc.add('deductions', g.minus(n));
    bySource.set(r.sourceId, src);

    for (const share of memberShares(r)) {
      if (view === 'me' && share.userId !== userId) continue;
      const pct = new Decimal(share.sharePct).div(100);
      byPerson.add(share.userId, net.times(pct));
      byPersonGross.add(share.userId, gross.times(pct));
    }

    for (const d of r.deductions) {
      const amount = convert(ctx, r.id, d.amount, r.currency, r.payDate);
      if (!amount) continue;
      const entry = byDeduction.get(d.deductionTypeId) ?? { ...d, amount: new Decimal(0) };
      entry.amount = entry.amount.plus(amount.times(factor));
      byDeduction.set(d.deductionTypeId, entry);
    }
  }

  const gross = totals.get('gross');
  return {
    gross: fmt(gross),
    deductions: fmt(totals.get('deductions')),
    net: fmt(totals.get('net')),
    /** Deductions as a % of gross. */
    effectiveDeductionRate: gross.isZero() ? '0.00' : fmt(totals.get('deductions').div(gross).times(100)),
    bySource: [...bySource.values()].map(({ acc, ...s }) => ({
      ...s,
      gross: fmt(acc.get('gross')),
      deductions: fmt(acc.get('deductions')),
      net: fmt(acc.get('net')),
    })),
    byPerson: byPerson.keys().map((id) => ({
      userId: id,
      gross: fmt(byPersonGross.get(id)),
      net: fmt(byPerson.get(id)),
      deductions: fmt(byPersonGross.get(id).minus(byPerson.get(id))),
    })),
    byKind: byKind.keys().map((kind) => ({ kind, net: fmt(byKind.get(kind)) })),
    deductionsByType: [...byDeduction.values()].map((d) => ({ ...d, amount: fmt(d.amount) })),
  };
};

export const summarizeExpenses = (rows: ExpenseRow[], ctx: ConvertCtx, view: View, userId: string) => {
  const totals = new Acc();
  const byCategory = new Map<string, { categoryId: string | null; name: string; color: string | null; acc: Acc }>();
  const byPerson = new Acc();

  for (const r of rows) {
    const factor = viewFactor(view, userId, r);
    if (factor.isZero()) continue;
    const amount = convert(ctx, r.id, r.amount, r.currency, r.date);
    if (!amount) continue;
    const a = amount.times(factor);
    totals.add('total', a);
    totals.add(r.status, a);
    totals.add(r.nature, a);
    totals.add(r.scope, a);

    const key = r.categoryId ?? 'none';
    const cat = byCategory.get(key) ?? {
      categoryId: r.categoryId,
      name: r.categoryName ?? 'Sin categoría',
      color: r.categoryColor,
      acc: new Acc(),
    };
    cat.acc.add('total', a);
    cat.acc.add(r.nature, a);
    cat.acc.add(r.status, a);
    byCategory.set(key, cat);

    for (const share of memberShares(r)) {
      if (view === 'me' && share.userId !== userId) continue;
      byPerson.add(share.userId, amount.times(share.sharePct).div(100));
    }
  }

  return {
    total: fmt(totals.get('total')),
    paid: fmt(totals.get('paid')),
    pending: fmt(totals.get('pending')),
    fixed: fmt(totals.get('fixed')),
    variable: fmt(totals.get('variable')),
    shared: fmt(totals.get('shared')),
    personal: fmt(totals.get('personal')),
    byCategory: [...byCategory.values()]
      .map(({ acc, ...c }) => ({
        ...c,
        total: fmt(acc.get('total')),
        fixed: fmt(acc.get('fixed')),
        variable: fmt(acc.get('variable')),
        pending: fmt(acc.get('pending')),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    byPerson: byPerson.keys().map((id) => ({ userId: id, total: fmt(byPerson.get(id)) })),
  };
};

/**
 * Who owes whom for shared expenses: each member's balance = paid - share.
 * Positive = others owe them. Settlements are a greedy minimal list of transfers.
 */
export const memberBalances = (rows: ExpenseRow[], ctx: ConvertCtx) => {
  const paid = new Acc();
  const share = new Acc();
  for (const r of rows) {
    if (r.scope !== 'shared' || r.status !== 'paid') continue;
    const amount = convert(ctx, r.id, r.amount, r.currency, r.date);
    if (!amount) continue;
    if (r.paidByUserId) paid.add(r.paidByUserId, amount);
    for (const s of r.splits) share.add(s.userId, amount.times(s.sharePct).div(100));
  }
  const ids = [...new Set([...paid.keys(), ...share.keys()])];
  const balances = ids.map((userId) => ({
    userId,
    paid: paid.get(userId),
    share: share.get(userId),
    balance: paid.get(userId).minus(share.get(userId)),
  }));

  const creditors = balances.filter((b) => b.balance.greaterThan(0.004)).map((b) => ({ id: b.userId, left: b.balance }));
  const debtors = balances.filter((b) => b.balance.lessThan(-0.004)).map((b) => ({ id: b.userId, left: b.balance.neg() }));
  const settlements: { fromUserId: string; toUserId: string; amount: string }[] = [];
  for (const d of debtors) {
    for (const c of creditors) {
      if (d.left.lessThanOrEqualTo(0.004)) break;
      if (c.left.lessThanOrEqualTo(0.004)) continue;
      const amount = Decimal.min(d.left, c.left);
      settlements.push({ fromUserId: d.id, toUserId: c.id, amount: fmt(amount) });
      d.left = d.left.minus(amount);
      c.left = c.left.minus(amount);
    }
  }

  return {
    members: balances.map((b) => ({ userId: b.userId, paid: fmt(b.paid), share: fmt(b.share), balance: fmt(b.balance) })),
    settlements,
  };
};
