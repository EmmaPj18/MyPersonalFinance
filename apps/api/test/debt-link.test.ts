import { describe, expect, it } from 'vitest';
import { registerUser, runJobs, setupApp } from './helpers';

const ctx = setupApp();

describe('fixed expenses that pay a loan', () => {
  it('turns past and future installments into debt payments with interest and principal', async () => {
    const me = await registerUser(ctx, 'Prestamo');
    const hid = me.me.household.id;
    const template = await me.ok('POST', '/recurring-expenses', {
      name: 'Préstamo consolidación',
      amount: '15000',
      currency: 'DOP',
      scope: 'personal',
      dueDay: 5,
      startDate: '2099-01-01',
    });
    await runJobs(ctx, hid, '2099-03-31');

    const link = await me.ok('POST', `/recurring-expenses/${template.id}/link-debt`, {
      newDebt: { name: 'Préstamo consolidación', originalAmount: '500000', interestRate: 18, startDate: '2099-01-01' },
      includePastPayments: true,
    });
    expect(link.registeredPayments).toBe(3);

    let [debt] = await me.ok<any[]>('GET', '/debts');
    expect(debt).toMatchObject({ currency: 'DOP', minPayment: '15000.00', dueDay: 5, recurringExpense: { id: template.id } });
    // 500,000 -> 492,500 -> 484,887.50 -> 477,160.81 (18% annual = 1.5% monthly interest)
    expect(debt.balance).toBe('477160.81');
    expect(debt.interestPaid).toBe('22160.81');

    // The next installment registered by the scheduler also pays the debt.
    await runJobs(ctx, hid, '2099-04-30');
    [debt] = await me.ok<any[]>('GET', '/debts');
    expect(debt.payments).toHaveLength(4);
    expect(debt.balance).toBe('469318.22');

    // Deleting an installment removes its payment.
    const [april] = await me.ok<any[]>('GET', '/expenses?month=2099-04');
    await me.ok('DELETE', `/expenses/${april.id}`);
    [debt] = await me.ok<any[]>('GET', '/debts');
    expect(debt.payments).toHaveLength(3);

    // Linking to a debt in another currency is rejected; unlinking keeps the payments.
    const usd = await me.ok('POST', '/debts', { name: 'USD', type: 'loan', originalAmount: '1000', currency: 'USD', startDate: '2099-01-01' });
    expect((await me.post(`/recurring-expenses/${template.id}/link-debt`, { debtId: usd.id })).status).toBe(400);
    await me.ok('POST', `/recurring-expenses/${template.id}/unlink-debt`);
    const debts = await me.ok<any[]>('GET', '/debts');
    expect(debts.find((d) => d.id === debt.id)).toMatchObject({ recurringExpense: null });
    expect(debts.find((d) => d.id === debt.id).payments).toHaveLength(3);
  });
});
