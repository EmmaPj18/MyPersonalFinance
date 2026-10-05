import { describe, expect, it } from 'vitest';
import { createCouple, registerUser, setupApp } from './helpers';

const ctx = setupApp();

describe('income: gross vs net', () => {
  it('computes net = gross - deductions and keeps the breakdown', async () => {
    const me = await registerUser(ctx, 'Emmanuel');
    const types = await me.ok<{ id: string; name: string }[]>('GET', '/deduction-types');
    const isr = types.find((t) => t.name === 'ISR')!.id;
    const afp = types.find((t) => t.name === 'AFP')!.id;
    const sfs = types.find((t) => t.name === 'SFS')!.id;

    const job = await me.ok('POST', '/income-sources', {
      name: 'Empleo formal',
      type: 'formal_employment',
      defaultCurrency: 'DOP',
      payFrequency: 'biweekly',
      deductionTemplates: [
        { deductionTypeId: afp, defaultAmount: '1219.75' },
        { deductionTypeId: sfs, defaultAmount: '1292.00' },
      ],
    });
    expect(job.scope).toBe('personal');
    expect(job.ownerUserId).toBe(me.me.id);

    const salary = await me.ok('POST', '/income-entries', {
      sourceId: job.id,
      kind: 'salary',
      payDate: '2026-10-15',
      grossAmount: '42500',
      currency: 'DOP',
      deductions: [
        { deductionTypeId: isr, amount: '3160.94' },
        { deductionTypeId: afp, amount: '1219.75' },
        { deductionTypeId: sfs, amount: '1292.00' },
      ],
    });
    expect(salary.netAmount).toBe('36827.31');

    const bonus = await me.ok('POST', '/income-entries', {
      sourceId: job.id,
      kind: 'bonus',
      payDate: '2026-10-20',
      grossAmount: '20000',
      currency: 'DOP',
      deductions: [{ deductionTypeId: isr, amount: '2000' }],
    });
    expect(bonus.netAmount).toBe('18000.00');

    const list = await me.ok<any[]>('GET', '/income-entries?month=2026-10');
    expect(list).toHaveLength(2);
    expect(list.find((e) => e.kind === 'salary').deductions).toHaveLength(3);

    const sources = await me.ok<any[]>('GET', '/income-sources');
    expect(sources[0].deductionTemplates).toHaveLength(2);
  });

  it('rejects deductions greater than gross', async () => {
    const me = await registerUser(ctx, 'Juan');
    const [type] = await me.ok<{ id: string }[]>('GET', '/deduction-types');
    const source = await me.ok('POST', '/income-sources', { name: 'Job', type: 'formal_employment', defaultCurrency: 'DOP' });
    const res = await me.post('/income-entries', {
      sourceId: source.id,
      kind: 'salary',
      payDate: '2026-10-15',
      grossAmount: '100',
      currency: 'DOP',
      deductions: [{ deductionTypeId: type!.id, amount: '150' }],
    });
    expect(res.status).toBe(400);
  });

  it('shared incomes (investments) are split between members', async () => {
    const { owner, wife } = await createCouple(ctx);
    const source = await owner.ok('POST', '/income-sources', {
      name: 'Certificado financiero',
      type: 'investment',
      scope: 'shared',
      defaultCurrency: 'DOP',
    });
    expect(source.ownerUserId).toBeNull();
    const entry = await wife.ok('POST', '/income-entries', {
      sourceId: source.id,
      kind: 'interest',
      payDate: '2026-10-01',
      grossAmount: '1000',
      currency: 'DOP',
    });
    expect(entry.splits.map((s: any) => s.sharePct).sort()).toEqual([50, 50]);

    const report = await owner.ok('GET', '/reports/monthly?month=2026-10&view=me');
    expect(report.income.net).toBe('500.00');
  });

  it('isolates households', async () => {
    const a = await registerUser(ctx, 'Ana');
    const b = await registerUser(ctx, 'Beto');
    const source = await a.ok('POST', '/income-sources', { name: 'Freelance', type: 'freelance', defaultCurrency: 'USD' });
    const res = await b.post('/income-entries', {
      sourceId: source.id,
      kind: 'freelance',
      payDate: '2026-10-01',
      grossAmount: '500',
      currency: 'USD',
    });
    expect(res.status).toBe(404);
    expect(await b.ok('GET', '/income-sources')).toHaveLength(0);
  });
});
