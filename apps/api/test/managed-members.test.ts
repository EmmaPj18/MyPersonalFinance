import { describe, expect, it } from 'vitest';
import { Client, registerUser, setupApp, uniqueEmail } from './helpers';

const ctx = setupApp();

const addManaged = async (owner: Client, name = 'Paola') =>
  owner.ok<{ id: string; accountStatus: string }>('POST', '/household/members', { name });

describe('members without an account', () => {
  it('take part in shared expenses but cannot own personal records or log in', async () => {
    const owner = await registerUser(ctx, 'Emmanuel');
    const paola = await addManaged(owner);
    expect(paola.accountStatus).toBe('managed');

    const household = await owner.ok('GET', '/household');
    expect(household.members.find((m: any) => m.id === paola.id)).toMatchObject({ email: null, accountStatus: 'managed' });

    // Default split includes the managed member and she can be the one who paid.
    const shared = await owner.ok('POST', '/expenses', {
      description: 'Supermercado',
      amount: '1000',
      currency: 'DOP',
      date: '2026-10-02',
      scope: 'shared',
      paidByUserId: paola.id,
    });
    expect(shared.splits.map((s: any) => s.userId).sort()).toEqual([owner.me.id, paola.id].sort());
    const balances = await owner.ok('GET', '/reports/member-balances');
    expect(balances.members.find((m: any) => m.userId === paola.id)).toMatchObject({ paid: '1000.00', balance: '500.00' });

    const personal = await owner.post('/expenses', {
      description: 'Ropa',
      amount: '100',
      currency: 'DOP',
      date: '2026-10-02',
      scope: 'personal',
      ownerUserId: paola.id,
    });
    expect(personal.status).toBe(400);

    // Can't be deleted while referenced; can be renamed.
    expect((await owner.del(`/household/members/${paola.id}`)).status).toBe(409);
    expect((await owner.ok('PATCH', `/household/members/${paola.id}`, { name: 'Paola María' })).name).toBe('Paola María');
  });

  it('can be claimed with a new account, keeping her history', async () => {
    const owner = await registerUser(ctx, 'Emmanuel');
    const paola = await addManaged(owner);
    await owner.ok('POST', '/expenses', { description: 'Luz', amount: '300', currency: 'DOP', date: '2026-10-03', scope: 'shared', paidByUserId: paola.id });

    const email = uniqueEmail('paola');
    const inv = await owner.ok('POST', `/household/members/${paola.id}/invite`, { email });
    const token = inv.url.split('/').pop();
    const info = await new Client(ctx).ok('GET', `/invitations/${token}`);
    expect(info).toMatchObject({ memberName: 'Paola', hasAccount: false });

    const claimer = new Client(ctx);
    await claimer.ok('POST', `/invitations/${token}/accept`, { password: 'secret123' });
    const me = await claimer.ok('GET', '/auth/me');
    expect(me).toMatchObject({ id: paola.id, email, name: 'Paola' });
    expect((await claimer.ok<any[]>('GET', '/expenses'))[0].paidByUserId).toBe(paola.id);

    // Now she has an account she can own personal records.
    expect(
      (await claimer.post('/expenses', { description: 'Ropa', amount: '50', currency: 'DOP', date: '2026-10-04', scope: 'personal' })).status,
    ).toBe(201);
  });

  it('merges into an existing account from another household', async () => {
    const owner = await registerUser(ctx, 'Emmanuel');
    const paola = await addManaged(owner);
    await owner.ok('POST', '/expenses', { description: 'Gas', amount: '200', currency: 'DOP', date: '2026-10-05', scope: 'shared', paidByUserId: paola.id });

    const existing = await registerUser(ctx, 'Paola');
    const inv = await owner.ok('POST', `/household/members/${paola.id}/invite`, { email: existing.me.email });
    await existing.ok('POST', `/invitations/${inv.url.split('/').pop()}/accept`);

    const household = await owner.ok('GET', '/household');
    expect(household.members.map((m: any) => m.id).sort()).toEqual([owner.me.id, existing.me.id].sort());
    const [expense] = await owner.ok<any[]>('GET', '/expenses');
    expect(expense.paidByUserId).toBe(existing.me.id);
    expect(expense.splits.map((s: any) => s.userId).sort()).toEqual([owner.me.id, existing.me.id].sort());
  });

  it('only owners manage them', async () => {
    const owner = await registerUser(ctx, 'Emmanuel');
    const paola = await addManaged(owner);
    const unused = await addManaged(owner, 'Temporal');
    expect((await owner.del(`/household/members/${unused.id}`)).status).toBe(204);
    expect((await owner.patch(`/household/members/${paola.id}`, { role: 'owner' })).status).toBe(400);
  });
});
