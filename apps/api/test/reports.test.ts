import { describe, expect, it } from 'vitest';
import { categoryId, createCouple, registerUser, runJobs, setupApp } from './helpers';

const ctx = setupApp();

describe('reports, FX and budgets', () => {
  it('converts multi-currency incomes into the requested currency', async () => {
    const me = await registerUser(ctx, 'Emmanuel');
    await me.ok('PUT', '/fx-rates', { date: '2026-10-01', fromCurrency: 'USD', toCurrency: 'DOP', rate: 63.5 });
    await me.ok('PUT', '/fx-rates', { date: '2026-10-01', fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.1 });
    const freelance = await me.ok('POST', '/income-sources', { name: 'Freelance', type: 'freelance', defaultCurrency: 'USD' });
    const job = await me.ok('POST', '/income-sources', { name: 'Empleo', type: 'formal_employment', defaultCurrency: 'DOP' });
    const [isr] = await me.ok<{ id: string }[]>('GET', '/deduction-types');

    await me.ok('POST', '/income-entries', { sourceId: freelance.id, kind: 'freelance', payDate: '2026-10-10', grossAmount: '1000', currency: 'USD' });
    await me.ok('POST', '/income-entries', { sourceId: freelance.id, kind: 'freelance', payDate: '2026-10-11', grossAmount: '100', currency: 'EUR' });
    await me.ok('POST', '/income-entries', {
      sourceId: job.id,
      kind: 'salary',
      payDate: '2026-10-15',
      grossAmount: '50000',
      currency: 'DOP',
      deductions: [{ deductionTypeId: isr!.id, amount: '5000' }],
    });

    const dop = await me.ok('GET', '/reports/monthly?month=2026-10&currency=DOP');
    // 1000*63.5 + 100*1.1*63.5 + 50000 = 63500 + 6985 + 50000
    expect(dop.income.gross).toBe('120485.00');
    expect(dop.income.net).toBe('115485.00');
    expect(dop.income.deductions).toBe('5000.00');
    expect(dop.missingRates).toEqual([]);

    const usd = await me.ok('GET', '/reports/monthly?month=2026-10&currency=USD');
    // 50000 DOP / 63.5 = 787.40 ; total = 1000 + 110 + 787.40
    expect(usd.income.gross).toBe('1897.40');
  });

  it('reports missing rates instead of guessing', async () => {
    const me = await registerUser(ctx, 'Sin tasas');
    const s = await me.ok('POST', '/income-sources', { name: 'Freelance', type: 'freelance', defaultCurrency: 'USD' });
    await me.ok('POST', '/income-entries', { sourceId: s.id, kind: 'freelance', payDate: '2026-10-10', grossAmount: '10', currency: 'USD' });
    const report = await me.ok('GET', '/reports/monthly?month=2026-10&currency=DOP');
    expect(report.missingRates).toEqual(['USD>DOP']);
    expect(report.income.gross).toBe('0.00');
  });

  it('annual budget: plan vs actual per month, suggestions and copy to next year', async () => {
    const { owner } = await createCouple(ctx);
    const hid = owner.me.household.id;
    const food = await categoryId(owner, 'Supermercado');
    const housing = await categoryId(owner, 'Vivienda');
    await owner.ok('POST', '/recurring-expenses', {
      name: 'Alquiler',
      categoryId: housing,
      amount: '30000',
      currency: 'DOP',
      scope: 'shared',
      dueDay: 1,
      startDate: '2026-10-01',
    });
    const account = await owner.ok('POST', '/accounts', { name: 'Nómina', type: 'bank', currency: 'DOP' });
    const job = await owner.ok('POST', '/income-sources', {
      name: 'Empleo',
      type: 'formal_employment',
      defaultCurrency: 'DOP',
      payDay: 30,
      scheduleStartDate: '2026-01-01',
      expectedGross: '80000',
      accountId: account.id,
    });

    const empty = await owner.ok('GET', '/budgets/2026');
    expect(empty).toMatchObject({ planId: null, lines: [] });

    // Suggestions come from fixed expenses and scheduled incomes, month by month.
    const suggestions = await owner.ok('POST', '/budgets/2026/suggestions');
    const rent = suggestions.lines.find((l: any) => l.categoryId === housing);
    expect(rent.amounts).toEqual([...Array(9).fill('0.00'), '30000.00', '30000.00', '30000.00']);
    const salary = suggestions.lines.find((l: any) => l.incomeSourceId === job.id);
    expect(salary.amounts.every((a: string) => a === '80000.00')).toBe(true);

    const monthly = (v: string) => Array(12).fill(v);
    await owner.ok('PUT', '/budgets/2026', {
      currency: 'DOP',
      lines: [
        { kind: 'income', incomeSourceId: job.id, amounts: salary.amounts },
        { kind: 'expense', categoryId: housing, scope: 'shared', amounts: rent.amounts },
        { kind: 'expense', categoryId: food, scope: 'shared', amounts: monthly('15000') },
      ],
    });
    await owner.ok('POST', '/expenses', { description: 'Super', amount: '4000', currency: 'DOP', date: '2026-10-08', categoryId: food, scope: 'shared' });
    await owner.ok('POST', '/expenses', { description: 'Cine', amount: '800', currency: 'DOP', date: '2026-10-09', scope: 'shared', categoryId: await categoryId(owner, 'Entretenimiento') });
    await runJobs(ctx, hid, '2026-10-31');

    const view = await owner.ok('GET', '/budgets/2026');
    const foodLine = view.lines.find((l: any) => l.categoryId === food);
    expect(foodLine).toMatchObject({ planTotal: '180000.00', actualTotal: '4000.00', nature: 'variable' });
    expect(foodLine.actual[9]).toBe('4000.00');
    const housingLine = view.lines.find((l: any) => l.categoryId === housing);
    expect(housingLine.actual[9]).toBe('30000.00');
    expect(view.unbudgeted).toMatchObject([{ name: 'Entretenimiento', actualTotal: '800.00' }]);
    expect(view.totals.expense.actual[9]).toBe('34800.00');
    expect(view.totals.income.planTotal).toBe('960000.00');

    // Duplicated lines are rejected.
    const dup = await owner.put('/budgets/2026', {
      currency: 'DOP',
      lines: [
        { kind: 'expense', categoryId: food, scope: 'shared', amounts: monthly('1') },
        { kind: 'expense', categoryId: food, scope: 'shared', amounts: monthly('2') },
      ],
    });
    expect(dup.status).toBe(400);

    const copied = await owner.ok('POST', '/budgets/2027/copy-previous', { adjustPct: 10 });
    expect(copied.lines.find((l: any) => l.categoryId === food).plan[0]).toBe('16500.00');
    expect((await owner.post('/budgets/2027/copy-previous', {})).status).toBe(409);
  });

  it('member balances say who owes whom', async () => {
    const { owner, wife } = await createCouple(ctx);
    await owner.ok('POST', '/expenses', { description: 'Super', amount: '1000', currency: 'DOP', date: '2026-10-01', scope: 'shared' });
    await wife.ok('POST', '/expenses', { description: 'Gas', amount: '400', currency: 'DOP', date: '2026-10-02', scope: 'shared' });
    const balances = await owner.ok('GET', '/reports/member-balances');
    const mine = balances.members.find((m: any) => m.userId === owner.me.id);
    expect(mine).toMatchObject({ paid: '1000.00', share: '700.00', balance: '300.00' });
    expect(balances.settlements).toEqual([{ fromUserId: wife.me.id, toUserId: owner.me.id, amount: '300.00' }]);
  });

  it('goals and debts track progress', async () => {
    const me = await registerUser(ctx, 'Ahorrador');
    const goal = await me.ok('POST', '/goals', { name: 'Fondo de emergencia', targetAmount: '100000', currency: 'DOP' });
    await me.ok('POST', `/goals/${goal.id}/contributions`, { amount: '25000', date: '2026-10-01' });
    const [g] = await me.ok<any[]>('GET', '/goals');
    expect(g).toMatchObject({ saved: '25000.00', progressPct: '25.00' });

    const debt = await me.ok('POST', '/debts', { name: 'Préstamo carro', type: 'loan', originalAmount: '500000', currency: 'DOP', startDate: '2026-01-01' });
    await me.ok('POST', `/debts/${debt.id}/payments`, { date: '2026-10-05', amount: '15000', interestPortion: '5000', createExpense: true });
    const [d] = await me.ok<any[]>('GET', '/debts');
    expect(d).toMatchObject({ principalPaid: '10000.00', interestPaid: '5000.00', balance: '490000.00' });
    const expenses = await me.ok<any[]>('GET', '/expenses?month=2026-10');
    expect(expenses[0]).toMatchObject({ amount: '15000.00', nature: 'fixed', categoryName: 'Préstamos' });
  });
});
