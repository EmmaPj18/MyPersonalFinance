import { EXPENSE_NATURES, RECURRENCE_FREQUENCIES, type Currency, type ExpenseNature, type RecurrenceFrequency } from '@mypersonalfinance/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  AccountSelect,
  CategorySelect,
  CurrencySelect,
  OwnerSelect,
  SplitEditor,
  splitsPayload,
  splitStateFrom,
  splitTotal,
  type Ownership,
  type SplitState,
} from '../../components/finance';
import { Button, Checkbox, ErrorBanner, Field, Input, MoneyInput, Segmented, Select } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { formatDate, RECURRENCE_LABELS, today } from '../../lib/format';
import { useCategories, useExpenseHistory } from '../../lib/queries';
import type { Expense, RecurringExpense } from '../../lib/types';

const NATURE_LABELS: Record<ExpenseNature, string> = { fixed: 'Fijo', variable: 'Corriente' };

const splitInvalid = (owner: Ownership, split: SplitState) =>
  owner.scope === 'shared' && split.custom && Math.abs(splitTotal(split) - 100) > 0.001;

const FormActions = ({ saving, disabled, onCancel, label = 'Guardar' }: { saving: boolean; disabled?: boolean; onCancel: () => void; label?: string }) => (
  <div className="flex justify-end gap-2">
    <Button variant="secondary" onClick={onCancel}>
      Cancelar
    </Button>
    <Button type="submit" loading={saving} disabled={disabled}>
      {label}
    </Button>
  </div>
);

const useSubmit = (onSubmit: (payload: unknown) => Promise<unknown>) => {
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const run = async (payload: unknown) => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(payload);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };
  return { error, saving, run };
};

const MemberSelect = ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) => {
  const { members } = usePrefs();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </Select>
  );
};

export const ExpenseForm = ({
  initial,
  defaultNature = 'variable',
  onSubmit,
  onCancel,
}: {
  initial?: Expense;
  defaultNature?: ExpenseNature;
  onSubmit: (payload: unknown) => Promise<unknown>;
  onCancel: () => void;
}) => {
  const { me } = usePrefs();
  const categories = useCategories();
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? me.defaultCurrency);
  const [date, setDate] = useState(initial?.date ?? today());
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [nature, setNature] = useState<ExpenseNature>(initial?.nature ?? defaultNature);
  const [owner, setOwner] = useState<Ownership>(
    initial ? { scope: initial.scope, ownerUserId: initial.ownerUserId } : { scope: 'shared', ownerUserId: null },
  );
  const [split, setSplit] = useState<SplitState>(splitStateFrom(initial?.splits));
  const [paidBy, setPaidBy] = useState(initial?.paidByUserId ?? me.id);
  const [accountId, setAccountId] = useState<string | null>(initial?.accountId ?? null);
  const [pending, setPending] = useState(initial?.status === 'pending');
  const { error, saving, run } = useSubmit(onSubmit);

  const changeCategory = (id: string | null) => {
    setCategoryId(id);
    const cat = categories.data?.find((c) => c.id === id);
    if (cat && !initial) setNature(cat.defaultNature);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (splitInvalid(owner, split)) return;
    void run({
      description,
      amount,
      currency,
      date,
      categoryId,
      nature,
      scope: owner.scope,
      ownerUserId: owner.ownerUserId,
      splits: owner.scope === 'shared' ? splitsPayload(split) : undefined,
      paidByUserId: paidBy,
      accountId,
      status: pending ? 'pending' : 'paid',
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Gasto">
      <ErrorBanner error={error} />
      <Field label="Descripción">{(id) => <Input id={id} required value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      <div className="grid grid-cols-[1fr_7rem] gap-4">
        <Field label="Monto">{(id) => <MoneyInput id={id} required value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Moneda">{(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fecha">{(id) => <Input id={id} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Categoría">{(id) => <CategorySelect id={id} value={categoryId} onChange={changeCategory} />}</Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Tipo de gasto</span>
          <Segmented<ExpenseNature>
            ariaLabel="Tipo de gasto"
            value={nature}
            onChange={setNature}
            options={EXPENSE_NATURES.map((n) => ({ value: n, label: NATURE_LABELS[n] }))}
          />
        </div>
        <Field label="De quién es el gasto">{(id) => <OwnerSelect id={id} value={owner} onChange={setOwner} />}</Field>
        <Field label="Pagado por">{(id) => <MemberSelect id={id} value={paidBy} onChange={setPaidBy} />}</Field>
        <Field label="Cuenta / medio de pago">{(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}</Field>
      </div>
      {owner.scope === 'shared' && <SplitEditor value={split} onChange={setSplit} amount={amount} currency={currency} />}
      <Checkbox label="Pendiente de pago" checked={pending} onChange={(e) => setPending(e.target.checked)} />
      <FormActions saving={saving} disabled={splitInvalid(owner, split)} onCancel={onCancel} />
    </form>
  );
};

export const PayForm = ({ expense, onSubmit, onCancel }: { expense: Expense; onSubmit: (payload: unknown) => Promise<unknown>; onCancel: () => void }) => {
  const { me } = usePrefs();
  const [amount, setAmount] = useState(expense.amount);
  const [date, setDate] = useState(today() < expense.date ? today() : expense.date);
  const [accountId, setAccountId] = useState<string | null>(expense.accountId);
  const [paidBy, setPaidBy] = useState(me.id);
  const { error, saving, run } = useSubmit(onSubmit);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run({ amount, date, accountId, paidByUserId: paidBy });
      }}
      className="flex flex-col gap-4"
    >
      <ErrorBanner error={error} />
      <Field label={`Monto real (${expense.currency})`} hint="Ajusta si el monto varió (ej. luz, agua).">
        {(id) => <MoneyInput id={id} required value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fecha de pago">{(id) => <Input id={id} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Pagado por">{(id) => <MemberSelect id={id} value={paidBy} onChange={setPaidBy} />}</Field>
        <Field label="Cuenta" className="sm:col-span-2">
          {(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}
        </Field>
      </div>
      <FormActions saving={saving} onCancel={onCancel} label="Marcar como pagado" />
    </form>
  );
};

const describeOwner = (value: Record<string, unknown> | null, nameOf: (id: string | null) => string) =>
  !value ? '—' : value.scope === 'shared' ? 'Hogar' : nameOf((value.ownerUserId as string) ?? null);

export const ReassignForm = ({
  current,
  expenseId,
  extra,
  onSubmit,
  onCancel,
}: {
  current: Ownership & { splits?: Expense['splits'] };
  expenseId?: string;
  extra?: ReactNode;
  onSubmit: (payload: unknown) => Promise<unknown>;
  onCancel: () => void;
}) => {
  const { nameOf } = usePrefs();
  const [owner, setOwner] = useState<Ownership>({ scope: current.scope, ownerUserId: current.ownerUserId });
  const [split, setSplit] = useState<SplitState>(splitStateFrom(current.scope === 'shared' ? current.splits : undefined));
  const history = useExpenseHistory(expenseId ?? null);
  const { error, saving, run } = useSubmit(onSubmit);
  const unchanged = owner.scope === current.scope && owner.ownerUserId === current.ownerUserId && !split.custom;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (splitInvalid(owner, split)) return;
        void run({ scope: owner.scope, ownerUserId: owner.ownerUserId, splits: owner.scope === 'shared' ? splitsPayload(split) : undefined });
      }}
      className="flex flex-col gap-4"
    >
      <ErrorBanner error={error} />
      <p className="text-sm text-muted">
        Actualmente: <strong className="text-text">{current.scope === 'shared' ? 'Hogar (común)' : nameOf(current.ownerUserId)}</strong>. Quién lo
        pagó no cambia; el balance entre miembros se recalcula.
      </p>
      <Field label="Nuevo dueño">{(id) => <OwnerSelect id={id} value={owner} onChange={setOwner} />}</Field>
      {owner.scope === 'shared' && <SplitEditor value={split} onChange={setSplit} />}
      {extra}
      <FormActions saving={saving} disabled={unchanged || splitInvalid(owner, split)} onCancel={onCancel} label="Cambiar dueño" />
      {expenseId && (history.data?.length ?? 0) > 0 && (
        <div className="border-t border-border pt-3">
          <h3 className="mb-2 text-sm font-medium">Historial</h3>
          <ul className="flex flex-col gap-1 text-xs text-muted">
            {history.data!.map((h) => (
              <li key={h.id}>
                {formatDate(h.at)} · {h.userName ?? '—'}:{' '}
                {h.action === 'reassign'
                  ? `${describeOwner(h.before, nameOf)} → ${describeOwner(h.after, nameOf)}`
                  : h.action}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
};

export const RecurringForm = ({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: RecurringExpense;
  onSubmit: (payload: unknown) => Promise<unknown>;
  onCancel: () => void;
}) => {
  const { me } = usePrefs();
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? me.defaultCurrency);
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [accountId, setAccountId] = useState<string | null>(initial?.accountId ?? null);
  const [owner, setOwner] = useState<Ownership>(
    initial ? { scope: initial.scope, ownerUserId: initial.ownerUserId } : { scope: 'shared', ownerUserId: null },
  );
  const [split, setSplit] = useState<SplitState>(splitStateFrom(initial?.splits));
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(initial?.frequency ?? 'monthly');
  const [dueDay, setDueDay] = useState(String(initial?.dueDay ?? 1));
  const [startDate, setStartDate] = useState(initial?.startDate ?? `${today().slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [variable, setVariable] = useState(initial?.isVariableAmount ?? false);
  const [active, setActive] = useState(initial?.active ?? true);
  const { error, saving, run } = useSubmit(onSubmit);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (splitInvalid(owner, split)) return;
        void run({
          name,
          amount,
          currency,
          categoryId,
          accountId,
          scope: owner.scope,
          ownerUserId: owner.ownerUserId,
          splits: owner.scope === 'shared' ? splitsPayload(split) : undefined,
          frequency,
          dueDay: Number(dueDay),
          startDate,
          endDate: endDate || null,
          isVariableAmount: variable,
          active,
        });
      }}
      className="flex flex-col gap-4"
      aria-label="Gasto fijo"
    >
      <ErrorBanner error={error} />
      <Field label="Nombre">{(id) => <Input id={id} required placeholder="Ej. Alquiler, Internet, Colegio" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="grid grid-cols-[1fr_7rem] gap-4">
        <Field label={variable ? 'Monto estimado' : 'Monto'}>{(id) => <MoneyInput id={id} required value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Moneda">{(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Categoría">{(id) => <CategorySelect id={id} value={categoryId} onChange={setCategoryId} />}</Field>
        <Field label="De quién es">{(id) => <OwnerSelect id={id} value={owner} onChange={setOwner} />}</Field>
        <Field label="Frecuencia">
          {(id) => (
            <Select id={id} value={frequency} onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}>
              {RECURRENCE_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {RECURRENCE_LABELS[f]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Día de vencimiento" hint={frequency === 'weekly' || frequency === 'biweekly' ? 'Se cuenta desde la fecha de inicio.' : undefined}>
          {(id) => <Input id={id} type="number" min={1} max={31} required value={dueDay} onChange={(e) => setDueDay(e.target.value)} />}
        </Field>
        <Field label="Desde">{(id) => <Input id={id} type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
        <Field label="Hasta (opcional)">{(id) => <Input id={id} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}</Field>
        <Field label="Cuenta" className="sm:col-span-2">
          {(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}
        </Field>
      </div>
      {owner.scope === 'shared' && <SplitEditor value={split} onChange={setSplit} amount={amount} currency={currency} />}
      <div className="flex flex-wrap gap-4">
        <Checkbox label="El monto varía cada mes" checked={variable} onChange={(e) => setVariable(e.target.checked)} />
        <Checkbox label="Activo" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>
      <FormActions saving={saving} disabled={splitInvalid(owner, split)} onCancel={onCancel} />
    </form>
  );
};
