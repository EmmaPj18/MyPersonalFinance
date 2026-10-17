import { describe, expect, it } from 'vitest';
import { categoryId, createCouple, registerUser, setupApp } from './helpers';

const ctx = setupApp();

describe('expenses', () => {
  it('shared expenses use the default split and personal ones belong to one member', async () => {
    const { owner, wife } = await createCouple(ctx);
    const food = await categoryId(owner, 'Supermercado');

    const shared = await owner.ok('POST', '/expenses', {
      description: 'Compra semanal',
      amount: '3000.01',
      currency: 'DOP',
      date: '2026-10-03',
      categoryId: food,
      scope: 'shared',
    });
    expect(shared.ownerUserId).toBeNull();
    expect(shared.splits.map((s: any) => s.shareAmount).sort()).toEqual(['1500.00', '1500.01']);

    const personal = await wife.ok('POST', '/expenses', {
      description: 'Ropa',
      amount: '2500',
      currency: 'DOP',
      date: '2026-10-04',
      scope: 'personal',
    });
    expect(personal.ownerUserId).toBe(wife.me.id);
    expect(personal.splits).toHaveLength(0);

    // Split must add up to 100.
    const bad = await owner.post('/expenses', {
      description: 'x',
      amount: '10',
      currency: 'DOP',
      date: '2026-10-04',
      scope: 'shared',
      splits: [
        { userId: owner.me.id, sharePct: 60 },
        { userId: wife.me.id, sharePct: 30 },
      ],
    });
    expect(bad.status).toBe(400);
  });

  it('reassigns person -> household -> other person, keeping an audit trail', async () => {
    const { owner, wife } = await createCouple(ctx);
    const expense = await owner.ok('POST', '/expenses', {
      description: 'Internet',
      amount: '2000',
      currency: 'DOP',
      date: '2026-10-05',
      scope: 'personal',
    });

    const toHousehold = await owner.ok('POST', `/expenses/${expense.id}/reassign`, {
      scope: 'shared',
      splits: [
        { userId: owner.me.id, sharePct: 70 },
        { userId: wife.me.id, sharePct: 30 },
      ],
    });
    expect(toHousehold.scope).toBe('shared');
    expect(toHousehold.splits).toHaveLength(2);

    const toWife = await owner.ok('POST', `/expenses/${expense.id}/reassign`, {
      scope: 'personal',
      ownerUserId: wife.me.id,
    });
    expect(toWife.ownerUserId).toBe(wife.me.id);
    expect(toWife.splits).toHaveLength(0);
    // Who paid doesn't change.
    expect(toWife.paidByUserId).toBe(owner.me.id);

    const history = await owner.ok<any[]>('GET', `/expenses/${expense.id}/history`);
    expect(history.map((h) => h.action)).toEqual(['reassign', 'reassign']);

    // A member can't reassign someone else's personal expense.
    const mine = await owner.ok('POST', '/expenses', {
      description: 'Gym',
      amount: '1500',
      currency: 'DOP',
      date: '2026-10-05',
      scope: 'personal',
    });
    const denied = await wife.post(`/expenses/${mine.id}/reassign`, { scope: 'shared' });
    expect(denied.status).toBe(403);
  });

  it('hides personal expenses of others in aggregated privacy mode but keeps them in reports', async () => {
    const { owner, wife } = await createCouple(ctx);
    await owner.ok('PATCH', '/household', { privacyMode: 'aggregated' });
    await wife.ok('POST', '/expenses', {
      description: 'Regalo sorpresa',
      amount: '5000',
      currency: 'DOP',
      date: '2026-10-06',
      scope: 'personal',
    });
    expect(await owner.ok('GET', '/expenses?month=2026-10')).toHaveLength(0);
    const report = await owner.ok('GET', '/reports/monthly?month=2026-10');
    expect(report.expenses.total).toBe('5000.00');
  });

  it('viewers cannot write', async () => {
    const owner = await registerUser(ctx, 'Owner');
    const email = `viewer-${Date.now()}@test.com`;
    const inv = await owner.ok('POST', '/household/invitations', { email, role: 'viewer' });
    const { Client } = await import('./helpers');
    const viewer = new Client(ctx);
    await viewer.ok('POST', `/invitations/${inv.url.split('/').pop()}/accept`, { name: 'Viewer', password: 'secret123' });
    const res = await viewer.post('/expenses', {
      description: 'x',
      amount: '1',
      currency: 'DOP',
      date: '2026-10-01',
      scope: 'shared',
    });
    expect(res.status).toBe(403);
    expect((await viewer.get('/expenses')).status).toBe(200);
  });
});
