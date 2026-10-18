import { describe, expect, it } from 'vitest';
import { registerUser, setupApp } from './helpers';

const ctx = setupApp();

describe('default split follows the household settings', () => {
  it('re-splits shared records without a custom split when the default split changes', async () => {
    const me = await registerUser(ctx, 'Emmanuel');
    // Recorded before the second member exists: 100% mine.
    const before = await me.ok('POST', '/expenses', { description: 'Mantenimiento', amount: '6000', currency: 'DOP', date: '2026-10-01', scope: 'shared' });
    const partner = await me.ok<{ id: string }>('POST', '/household/members', { name: 'Mariela' });
    const custom = await me.ok('POST', '/expenses', {
      description: 'Regalo',
      amount: '1000',
      currency: 'DOP',
      date: '2026-10-02',
      scope: 'shared',
      splits: [{ userId: me.me.id, sharePct: 100 }],
    });
    expect(custom.customSplit).toBe(true);

    const rent = await me.ok('POST', '/income-sources', { name: 'Alquiler', type: 'investment', defaultCurrency: 'DOP', scope: 'shared' });
    const income = await me.ok('POST', '/income-entries', { sourceId: rent.id, kind: 'other', payDate: '2026-10-05', grossAmount: '10000', currency: 'DOP', deductions: [] });

    const share = async (userId: string) =>
      (await me.ok<any>('GET', '/reports/member-balances')).members.find((m: any) => m.userId === userId)?.share ?? '0.00';

    await me.ok('PATCH', `/household/members/${me.me.id}`, { defaultSplitPct: 60 });
    await me.ok('PATCH', `/household/members/${partner.id}`, { defaultSplitPct: 40 });
    // 60/40 of the default-split expense; the custom one stays 100% mine.
    expect(await share(partner.id)).toBe('2400.00');
    expect(await share(me.me.id)).toBe('4600.00');
    const [entry] = (await me.ok<any[]>('GET', '/income-entries')).filter((e) => e.id === income.id);
    expect(entry.splits.find((sp: any) => sp.userId === partner.id)).toMatchObject({ sharePct: '40.00' });

    await me.ok('PATCH', `/household/members/${me.me.id}`, { defaultSplitPct: 100 });
    await me.ok('PATCH', `/household/members/${partner.id}`, { defaultSplitPct: 0 });
    expect(await share(partner.id)).toBe('0.00');
    expect(await share(me.me.id)).toBe('7000.00');

    // Editing without a split keeps following the default; sending [] turns a custom split back to default.
    const [edited] = await me.ok<any[]>('GET', '/expenses?month=2026-10').then((rows) => rows.filter((r) => r.id === before.id));
    expect(edited.customSplit).toBe(false);
    const reset = await me.ok('PUT', `/expenses/${custom.id}`, {
      description: 'Regalo',
      amount: '1000',
      currency: 'DOP',
      date: '2026-10-02',
      scope: 'shared',
      splits: [],
    });
    expect(reset.customSplit).toBe(false);
  });
});
