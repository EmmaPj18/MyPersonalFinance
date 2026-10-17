import {
  EXPENSE_NATURES,
  occurrencesBetween,
  RECURRENCE_FREQUENCIES,
  WEEKEND_RULES,
  type Currency,
  type ExpenseNature,
  type RecurrenceFrequency,
  type WeekendRule,
} from '@mypersonalfinance/shared';
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
import { formatDate, formatShortDate, RECURRENCE_LABELS, today, WEEKEND_RULE_LABELS } from '../../lib/format';
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

export interface ScheduleState {
  frequency: RecurrenceFrequency;
  dueDay: string;
  secondDueDay: string;
  startDate: string;
  endDate: string;
  weekendRule: WeekendRule;
}

const scheduleDays = (s: ScheduleState) =>
  s.frequency === 'semimonthly' ? [Number(s.dueDay), Number(s.secondDueDay)].sort((a, b) => a - b) : [Number(s.dueDay)];

export const schedulePayload = (s: ScheduleState) => {
  const [day, second] = scheduleDays(s);
  return {
    frequency: s.frequency,
    dueDay: day,
    secondDueDay: s.frequency === 'semimonthly' ? second : null,
    startDate: s.startDate,
    endDate: s.endDate || null,
    weekendRule: s.weekendRule,
  };
};

/** Next few dates of a schedule, for a live preview. */
const schedulePreview = (s: ScheduleState) => {
  const days = scheduleDays(s);
  if (!s.startDate || days.some((d) => !(d >= 1 && d <= 31))) return [];
  const from = today() > s.startDate ? today() : s.startDate;
  return occurrencesBetween(
    { frequency: s.frequency, day: days[0]!, secondDay: days[1], startDate: s.startDate, endDate: s.endDate || null, weekendRule: s.weekendRule },
    from,
    `${Number(from.slice(0, 4)) + 2}-12-31`,
  ).slice(0, 4);
};

/** Frequency, day(s), dates and weekend rule. `fixedStart` hides the start date (taken from the expense date). */
export const ScheduleFields = ({
  value,
  onChange,
  fixedStart,
}: {
  value: ScheduleState;
  onChange: (v: ScheduleState) => void;
  fixedStart?: boolean;
}) => {
  const set = (patch: Partial<ScheduleState>) => onChange({ ...value, ...patch });
  const stepsFromStart = value.frequency === 'weekly' || value.frequency === 'biweekly';
  const preview = schedulePreview(value);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Frecuencia">
          {(id) => (
            <Select
              id={id}
              value={value.frequency}
              onChange={(e) => {
                const frequency = e.target.value as RecurrenceFrequency;
                set(frequency === 'semimonthly' && !value.secondDueDay ? { frequency, dueDay: '15', secondDueDay: '30' } : { frequency });
              }}
            >
              {RECURRENCE_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {RECURRENCE_LABELS[f]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!stepsFromStart && !fixedStart && (
          <div className={value.frequency === 'semimonthly' ? 'grid grid-cols-2 gap-4' : ''}>
            <Field label={value.frequency === 'semimonthly' ? 'Primer día' : 'Día de pago'} hint="30 o 31 = último día">
              {(id) => <Input id={id} type="number" min={1} max={31} required value={value.dueDay} onChange={(e) => set({ dueDay: e.target.value })} />}
            </Field>
            {value.frequency === 'semimonthly' && (
              <Field label="Segundo día">
                {(id) => (
                  <Input id={id} type="number" min={1} max={31} required value={value.secondDueDay} onChange={(e) => set({ secondDueDay: e.target.value })} />
                )}
              </Field>
            )}
          </div>
        )}
        {fixedStart && value.frequency === 'semimonthly' && (
          <Field label="Segundo día del mes">
            {(id) => <Input id={id} type="number" min={1} max={31} required value={value.secondDueDay} onChange={(e) => set({ secondDueDay: e.target.value })} />}
          </Field>
        )}
        {!fixedStart && (
          <Field label={stepsFromStart ? 'Fecha del primer pago' : 'Desde'}>
            {(id) => <Input id={id} type="date" required value={value.startDate} onChange={(e) => set({ startDate: e.target.value })} />}
          </Field>
        )}
        <Field label="Hasta (opcional)">{(id) => <Input id={id} type="date" value={value.endDate} onChange={(e) => set({ endDate: e.target.value })} />}</Field>
        <Field label="Si cae en fin de semana">
          {(id) => (
            <Select id={id} value={value.weekendRule} onChange={(e) => set({ weekendRule: e.target.value as WeekendRule })}>
              {WEEKEND_RULES.map((r) => (
                <option key={r} value={r}>
                  {WEEKEND_RULE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {preview.length > 0 && <p className="text-xs text-muted">Próximas fechas: {preview.map(formatShortDate).join(' · ')}</p>}
    </div>
  );
};

export const ExpenseForm = ({
  initial,
  defaultNature = 'variable',
  onSubmit,
  onSubmitRecurring,
  onCancel,
}: {
  initial?: Expense;
  defaultNature?: ExpenseNature;
  onSubmit: (payload: unknown) => Promise<unknown>;
  /** Called instead of onSubmit when the user marks a new expense as repeating. */
  onSubmitRecurring?: (payload: unknown) => Promise<unknown>;
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
  const [repeat, setRepeat] = useState(!initial && defaultNature === 'fixed');
  const [schedule, setSchedule] = useState<ScheduleState>({
    frequency: 'monthly',
    dueDay: '1',
    secondDueDay: '',
    startDate: '',
    endDate: '',
    weekendRule: 'none',
  });
  const [variableAmount, setVariableAmount] = useState(false);
  const [autoPay, setAutoPay] = useState(true);
  const { error, saving, run } = useSubmit(repeat && onSubmitRecurring ? onSubmitRecurring : onSubmit);
  // A repeating expense starts on the expense date, which also gives its day of the month.
  const effectiveSchedule: ScheduleState = { ...schedule, startDate: date, dueDay: String(Number(date.slice(8, 10)) || 1) };

  const changeCategory = (id: string | null) => {
    setCategoryId(id);
    const cat = categories.data?.find((c) => c.id === id);
    if (cat && !initial) setNature(cat.defaultNature);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (splitInvalid(owner, split)) return;
    if (repeat && onSubmitRecurring) {
      void run({
        name: description,
        amount,
        currency,
        categoryId,
        accountId,
        scope: owner.scope,
        ownerUserId: owner.ownerUserId,
        splits: owner.scope === 'shared' ? splitsPayload(split) : undefined,
        paidByUserId: paidBy,
        isVariableAmount: variableAmount,
        autoPay,
        ...schedulePayload(effectiveSchedule),
      });
      return;
    }
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
      {!initial && onSubmitRecurring && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <Checkbox label="Se repite (gasto fijo)" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
          {repeat && (
            <>
              <p className="text-xs text-muted">
                Se registrará automáticamente en cada fecha a partir del {date ? formatShortDate(date) : '…'} (incluida).
              </p>
              <ScheduleFields value={effectiveSchedule} onChange={setSchedule} fixedStart />
              <div className="flex flex-wrap gap-4">
                <Checkbox label="Registrar como pagado automáticamente" checked={autoPay} onChange={(e) => setAutoPay(e.target.checked)} />
                <Checkbox label="El monto varía (se usa como estimado)" checked={variableAmount} onChange={(e) => setVariableAmount(e.target.checked)} />
              </div>
            </>
          )}
        </div>
      )}
      {!repeat && <Checkbox label="Pendiente de pago" checked={pending} onChange={(e) => setPending(e.target.checked)} />}
      <FormActions saving={saving} disabled={splitInvalid(owner, split)} onCancel={onCancel} label={repeat ? 'Crear gasto fijo' : 'Guardar'} />
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
  fromExpense,
  onSubmit,
  onCancel,
}: {
  initial?: RecurringExpense;
  /** Existing expense being converted into a fixed one (becomes its first occurrence). */
  fromExpense?: Expense;
  onSubmit: (payload: unknown) => Promise<unknown>;
  onCancel: () => void;
}) => {
  const { me } = usePrefs();
  const base = initial ?? fromExpense;
  const [name, setName] = useState(initial?.name ?? fromExpense?.description ?? '');
  const [amount, setAmount] = useState(base?.amount ?? '');
  const [currency, setCurrency] = useState<Currency>(base?.currency ?? me.defaultCurrency);
  const [categoryId, setCategoryId] = useState<string | null>(base?.categoryId ?? null);
  const [accountId, setAccountId] = useState<string | null>(base?.accountId ?? null);
  const [owner, setOwner] = useState<Ownership>(base ? { scope: base.scope, ownerUserId: base.ownerUserId } : { scope: 'shared', ownerUserId: null });
  const [split, setSplit] = useState<SplitState>(splitStateFrom(base?.splits));
  const [paidBy, setPaidBy] = useState(initial?.paidByUserId ?? fromExpense?.paidByUserId ?? me.id);
  const [schedule, setSchedule] = useState<ScheduleState>({
    frequency: initial?.frequency ?? 'monthly',
    dueDay: String(initial?.dueDay ?? (fromExpense ? Number(fromExpense.date.slice(8, 10)) : 1)),
    secondDueDay: initial?.secondDueDay ? String(initial.secondDueDay) : '',
    startDate: initial?.startDate ?? fromExpense?.date ?? today(),
    endDate: initial?.endDate ?? '',
    weekendRule: initial?.weekendRule ?? 'none',
  });
  const [variable, setVariable] = useState(initial?.isVariableAmount ?? false);
  const [autoPay, setAutoPay] = useState(initial?.autoPay ?? true);
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
          paidByUserId: paidBy,
          isVariableAmount: variable,
          autoPay,
          active,
          linkExpenseId: fromExpense?.id,
          ...schedulePayload(schedule),
        });
      }}
      className="flex flex-col gap-4"
      aria-label="Gasto fijo"
    >
      <ErrorBanner error={error} />
      {fromExpense && (
        <p className="text-sm text-muted">El gasto del {formatDate(fromExpense.date)} quedará como el primer pago de este gasto fijo.</p>
      )}
      <Field label="Nombre">{(id) => <Input id={id} required placeholder="Ej. Alquiler, Internet, Colegio" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="grid grid-cols-[1fr_7rem] gap-4">
        <Field label={variable ? 'Monto estimado' : 'Monto'}>{(id) => <MoneyInput id={id} required value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Moneda">{(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Categoría">{(id) => <CategorySelect id={id} value={categoryId} onChange={setCategoryId} />}</Field>
        <Field label="De quién es">{(id) => <OwnerSelect id={id} value={owner} onChange={setOwner} />}</Field>
        <Field label="Lo paga">{(id) => <MemberSelect id={id} value={paidBy} onChange={setPaidBy} />}</Field>
        <Field label="Cuenta / medio de pago">{(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}</Field>
      </div>
      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">Cuándo se paga</legend>
        <ScheduleFields value={schedule} onChange={setSchedule} />
      </fieldset>
      {owner.scope === 'shared' && <SplitEditor value={split} onChange={setSplit} amount={amount} currency={currency} />}
      <div className="flex flex-wrap gap-4">
        <Checkbox label="Registrar como pagado automáticamente" checked={autoPay} onChange={(e) => setAutoPay(e.target.checked)} />
        <Checkbox label="El monto varía cada mes" checked={variable} onChange={(e) => setVariable(e.target.checked)} />
        <Checkbox label="Activo" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>
      {!autoPay && <p className="text-xs text-muted">Se creará como pendiente en cada fecha y lo marcarás pagado manualmente.</p>}
      <FormActions saving={saving} disabled={splitInvalid(owner, split)} onCancel={onCancel} />
    </form>
  );
};
