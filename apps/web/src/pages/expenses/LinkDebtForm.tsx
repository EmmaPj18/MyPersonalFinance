import { DEBT_TYPES, type DebtType } from '@mypersonalfinance/shared';
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Input, MoneyInput, Segmented, Select } from '../../components/ui';
import { DEBT_TYPE_LABELS } from '../../lib/format';
import { useDebts } from '../../lib/queries';
import type { RecurringExpense } from '../../lib/types';

/** Turns a fixed expense into the installments of a loan (new or existing debt). */
export const LinkDebtForm = ({
  template,
  onSubmit,
  onCancel,
}: {
  template: RecurringExpense;
  onSubmit: (payload: unknown) => Promise<unknown>;
  onCancel: () => void;
}) => {
  const debts = useDebts();
  const candidates = (debts.data ?? []).filter((d) => !d.archived && d.currency === template.currency && !d.recurringExpense);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [debtId, setDebtId] = useState('');
  const [name, setName] = useState(template.name);
  const [type, setType] = useState<DebtType>(/hipoteca/i.test(template.name) ? 'mortgage' : 'loan');
  const [originalAmount, setOriginalAmount] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [startDate, setStartDate] = useState(template.startDate);
  const [includePast, setIncludePast] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(
        mode === 'existing'
          ? { debtId, includePastPayments: includePast }
          : {
              newDebt: { name, type, originalAmount, interestRate: interestRate === '' ? null : Number(interestRate), startDate },
              includePastPayments: includePast,
            },
      );
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ErrorBanner error={error} />
      <p className="text-sm text-muted">
        "{template.name}" seguirá siendo un gasto fijo de tu presupuesto, y cada cuota pagada se registrará también como abono a la deuda, separando
        interés y capital.
      </p>
      <Segmented<'new' | 'existing'>
        ariaLabel="Deuda"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'new', label: 'Crear deuda' },
          { value: 'existing', label: 'Usar una existente' },
        ]}
      />
      {mode === 'existing' ? (
        <Field label={`Deuda (${template.currency})`}>
          {(id) => (
            <Select id={id} required value={debtId} onChange={(e) => setDebtId(e.target.value)}>
              <option value="">Selecciona…</option>
              {candidates.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as DebtType)}>
                {DEBT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DEBT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={includePast ? `Monto original del préstamo (${template.currency})` : `Saldo pendiente hoy (${template.currency})`}
            hint={includePast ? 'Lo que te prestaron al inicio.' : 'Lo que debes hoy según tu banco.'}
          >
            {(id) => <MoneyInput id={id} required value={originalAmount} onChange={(e) => setOriginalAmount(e.target.value)} />}
          </Field>
          <Field label="Tasa anual % (opcional)" hint="Para separar interés y capital en cada cuota.">
            {(id) => <Input id={id} type="number" min="0" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} />}
          </Field>
          <Field label="Fecha de inicio">{(id) => <Input id={id} type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
        </div>
      )}
      <Checkbox
        label="Registrar como abonos las cuotas ya pagadas de este gasto fijo"
        checked={includePast}
        onChange={(e) => setIncludePast(e.target.checked)}
      />
      {mode === 'new' && !includePast && (
        <p className="text-xs text-muted">Sin las cuotas pasadas, usa el saldo pendiente de hoy como monto de la deuda.</p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving} disabled={mode === 'existing' && !debtId}>
          Vincular
        </Button>
      </div>
    </form>
  );
};
