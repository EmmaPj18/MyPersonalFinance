import { describe, expect, it } from 'vitest';
import { categoryId, Client, createCouple, registerUser, setupApp } from './helpers';

const ctx = setupApp();

describe('household membership', () => {
  it('a member leaving takes personal data and leaves shared data behind', async () => {
    const { owner, wife } = await createCouple(ctx);
    const food = await categoryId(owner, 'Supermercado');
    const oldHousehold = owner.me.household.id;

    const account = await wife.ok('POST', '/accounts', {
      name: 'Cuenta de ella',
      type: 'bank',
      currency: 'DOP',
      ownerUserId: wife.me.id,
    });
    const job = await wife.ok('POST', '/income-sources', { name: 'Trabajo de ella', type: 'formal_employment', defaultCurrency: 'DOP' });
    await wife.ok('POST', '/income-entries', {
      sourceId: job.id,
      kind: 'salary',
      payDate: '2026-10-15',
      grossAmount: '50000',
      currency: 'DOP',
      accountId: account.id,
    });
    await wife.ok('POST', '/expenses', {
      description: 'Personal',
      amount: '100',
      currency: 'DOP',
      date: '2026-10-02',
      scope: 'personal',
      categoryId: food,
    });
    await wife.ok('POST', '/expenses', {
      description: 'Compartido',
      amount: '200',
      currency: 'DOP',
      date: '2026-10-02',
      scope: 'shared',
      accountId: account.id,
    });

    const preview = await wife.ok('GET', '/household/leave-preview');
    expect(preview.moves).toMatchObject({ accounts: 1, incomeSources: 1, incomeEntries: 1, personalExpenses: 1 });
    expect(preview.stays.sharedExpenses).toBe(1);

    const result = await wife.ok('POST', '/household/leave');
    expect(result.householdId).not.toBe(oldHousehold);
    expect(result.role).toBe('owner');

    // Wife in her new household sees her personal data with remapped category.
    const myExpenses = await wife.ok<any[]>('GET', '/expenses');
    expect(myExpenses.map((e) => e.description)).toEqual(['Personal']);
    const newFood = await categoryId(wife, 'Supermercado');
    expect(myExpenses[0].categoryId).toBe(newFood);
    expect(await wife.ok('GET', '/income-entries')).toHaveLength(1);
    expect(await wife.ok('GET', '/accounts')).toHaveLength(1);

    // Old household keeps the shared expense, detached from her (moved) account; she shows as ex-member.
    const ownerExpenses = await owner.ok<any[]>('GET', '/expenses');
    expect(ownerExpenses.map((e) => e.description)).toEqual(['Compartido']);
    expect(ownerExpenses[0].accountId).toBeNull();
    const household = await owner.ok('GET', '/household');
    expect(household.members).toHaveLength(1);
    expect(household.exMembers.map((m: any) => m.id)).toEqual([wife.me.id]);
  });

  it('the last owner cannot leave while other members remain', async () => {
    const { owner } = await createCouple(ctx);
    const res = await owner.post('/household/leave');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('LAST_OWNER');
  });

  it('an existing user accepting an invitation switches household', async () => {
    const a = await registerUser(ctx, 'Ana');
    const b = await registerUser(ctx, 'Beto');
    await b.ok('POST', '/expenses', { description: 'Mío', amount: '50', currency: 'USD', date: '2026-10-01', scope: 'personal' });
    const inv = await a.ok('POST', '/household/invitations', { email: b.me.email, role: 'member' });
    const token = inv.url.split('/').pop();

    const info = await new Client(ctx).ok('GET', `/invitations/${token}`);
    expect(info.hasAccount).toBe(true);
    // Must be logged in as the invited account.
    expect((await new Client(ctx).post(`/invitations/${token}/accept`)).status).toBe(401);
    expect((await a.post(`/invitations/${token}/accept`)).status).toBe(403);

    const moved = await b.ok('POST', `/invitations/${token}/accept`);
    expect(moved.householdId).toBe(a.me.household.id);
    expect((await a.ok('GET', '/household')).members).toHaveLength(2);
    // Personal data came along.
    expect(await b.ok<any[]>('GET', '/expenses')).toHaveLength(1);
    // Invitation can't be reused.
    expect((await b.post(`/invitations/${token}/accept`)).status).toBe(404);
  });

  it('owner can remove a member, who ends up in their own household', async () => {
    const { owner, wife } = await createCouple(ctx);
    expect((await owner.del(`/household/members/${wife.me.id}`)).status).toBe(204);
    const me = await wife.ok('GET', '/auth/me');
    expect(me.household.id).not.toBe(owner.me.household.id);
    expect(me.role).toBe('owner');
  });

  it('transfers ownership', async () => {
    const { owner, wife } = await createCouple(ctx);
    await owner.ok('POST', '/household/transfer-ownership', { userId: wife.me.id });
    expect((await owner.ok('GET', '/auth/me')).role).toBe('member');
    expect((await wife.ok('GET', '/auth/me')).role).toBe('owner');
    // Now the former owner can leave.
    expect((await owner.post('/household/leave')).status).toBe(200);
  });
});
