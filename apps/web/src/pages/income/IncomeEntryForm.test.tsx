import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrefsProvider } from '../../context/prefs';
import type { DeductionType, Household, IncomeSource, Me } from '../../lib/types';
import { IncomeEntryForm } from './IncomeEntryForm';

const me: Me = {
  id: 'u1',
  email: 'emma@test.com',
  name: 'Emmanuel',
  role: 'owner',
  defaultCurrency: 'DOP',
  defaultSplitPct: null,
  household: { id: 'h1', name: 'Hogar', baseCurrency: 'DOP', privacyMode: 'open' },
};

const deductionTypes: DeductionType[] = [
  { id: 'isr', name: 'ISR', category: 'income_tax', archived: false },
  { id: 'afp', name: 'AFP', category: 'pension', archived: false },
];

const job: IncomeSource = {
  id: 's1',
  name: 'Empleo formal',
  type: 'formal_employment',
  scope: 'personal',
  ownerUserId: 'u1',
  defaultCurrency: 'DOP',
  payFrequency: 'monthly',
  accountId: null,
  isActive: true,
  deductionTemplates: [{ deductionTypeId: 'afp', defaultAmount: '2439.50' }],
};

const renderForm = (onSubmit = vi.fn().mockResolvedValue(undefined), defaultKind?: 'bonus') => {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const household: Household = { ...me.household, members: [{ ...me, defaultSplitPct: null }], exMembers: [] };
  qc.setQueryData(['household'], household);
  qc.setQueryData(['accounts'], []);
  render(
    <QueryClientProvider client={qc}>
      <PrefsProvider me={me}>
        <IncomeEntryForm sources={[job]} deductionTypes={deductionTypes} defaultKind={defaultKind} onSubmit={onSubmit} onCancel={() => {}} />
      </PrefsProvider>
    </QueryClientProvider>,
  );
  return onSubmit;
};

describe('IncomeEntryForm', () => {
  it('pre-fills the source template and computes the net live', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    expect(screen.getAllByLabelText('Monto del descuento')[0]).toHaveValue(2439.5);
    await user.type(screen.getByLabelText('Monto bruto'), '85000');
    expect(within(screen.getByTestId('net-amount')).getByText(/82[.,]560[.,]50/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Agregar descuento' }));
    const typeSelects = screen.getAllByLabelText('Tipo de descuento');
    await user.selectOptions(typeSelects[1]!, 'isr');
    await user.type(screen.getAllByLabelText('Monto del descuento')[1]!, '7000');
    expect(within(screen.getByTestId('net-amount')).getByText(/75[.,]560[.,]50/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 's1',
        kind: 'salary',
        grossAmount: '85000',
        currency: 'DOP',
        deductions: [
          { deductionTypeId: 'afp', amount: '2439.50' },
          { deductionTypeId: 'isr', amount: '7000' },
        ],
      }),
    );
  });

  it('blocks deductions above the gross amount', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText('Monto bruto'), '1000');
    expect(screen.getByText('Los descuentos no pueden superar el monto bruto.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('bonuses start without payroll deductions', () => {
    renderForm(undefined, 'bonus');
    expect(screen.queryAllByLabelText('Monto del descuento')).toHaveLength(0);
    expect(screen.getByLabelText('Tipo de pago')).toHaveValue('bonus');
  });
});
