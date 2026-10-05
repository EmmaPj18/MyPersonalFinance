import { computeNet, INCOME_KINDS, isNegative, type Currency, type IncomeKind, type IncomeSourceType } from '@mypersonalfinance/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AccountSelect, CurrencySelect, Money, SplitEditor, splitsPayload, splitStateFrom, splitTotal, type SplitState } from '../../components/finance';
import { Button, ErrorBanner, Field, IconButton, Input, MoneyInput, Select, Textarea } from '../../components/ui';
import { INCOME_KIND_LABELS, today } from '../../lib/format';
import type { DeductionType, IncomeEntry, IncomeSource } from '../../lib/types';

const DEFAULT_KIND: Record<IncomeSourceType, IncomeKind> = {
  formal_employment: 'salary',
  informal_employment: 'salary',
  freelance: 'freelance',
  investment: 'investment_return',
  savings_interest: 'interest',
  rental: 'other',
  other: 'other',
};

interface DeductionRow {
  key: number;
  deductionTypeId: string;
  amount: string;
}

export interface IncomeEntryPayload {
  sourceId: string;
  kind: IncomeKind;
  payDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  grossAmount: string;
  currency: Currency;
  accountId: string | null;
  notes: string | null;
  deductions: { deductionTypeId: string; amount: string }[];
  splits?: { userId: string; sharePct: number }[];
}

let rowKey = 0;
const rowsFromTemplate = (source: IncomeSource | undefined): DeductionRow[] =>
  (source?.deductionTemplates ?? []).map((t) => ({ key: ++rowKey, deductionTypeId: t.deductionTypeId, amount: t.defaultAmount }));

export const IncomeEntryForm = ({
  sources,
  deductionTypes,
  initial,
  defaultSourceId,
  defaultKind,
  onSubmit,
  onCancel,
}: {
  sources: IncomeSource[];
  deductionTypes: DeductionType[];
  initial?: IncomeEntry;
  defaultSourceId?: string;
  defaultKind?: IncomeKind;
  onSubmit: (payload: IncomeEntryPayload) => Promise<unknown>;
  onCancel: () => void;
}) => {
  const firstSource = sources.find((s) => s.id === (initial?.sourceId ?? defaultSourceId)) ?? sources[0];
  const [sourceId, setSourceId] = useState(firstSource?.id ?? '');
  const [kind, setKind] = useState<IncomeKind>(initial?.kind ?? defaultKind ?? (firstSource ? DEFAULT_KIND[firstSource.type] : 'salary'));
  const [payDate, setPayDate] = useState(initial?.payDate ?? today());
  const [periodStart, setPeriodStart] = useState(initial?.periodStart ?? '');
  const [periodEnd, setPeriodEnd] = useState(initial?.periodEnd ?? '');
  const [gross, setGross] = useState(initial?.grossAmount ?? '');
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? firstSource?.defaultCurrency ?? 'DOP');
  const [accountId, setAccountId] = useState<string | null>(initial?.accountId ?? firstSource?.accountId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [rows, setRows] = useState<DeductionRow[]>(() =>
    initial
      ? initial.deductions.map((d) => ({ key: ++rowKey, deductionTypeId: d.deductionTypeId, amount: d.amount }))
      : // Bonuses usually don't carry the regular payroll deductions.
        defaultKind === 'bonus'
        ? []
        : rowsFromTemplate(firstSource),
  );
  const [split, setSplit] = useState<SplitState>(splitStateFrom(initial?.splits));
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const source = sources.find((s) => s.id === sourceId);
  const usableTypes = deductionTypes.filter((t) => !t.archived || rows.some((r) => r.deductionTypeId === t.id));

  const changeSource = (id: string) => {
    const next = sources.find((s) => s.id === id);
    setSourceId(id);
    if (!next) return;
    setCurrency(next.defaultCurrency);
    setAccountId(next.accountId);
    setKind(DEFAULT_KIND[next.type]);
    setRows(rowsFromTemplate(next));
  };

  const validRows = rows.filter((r) => r.deductionTypeId && r.amount !== '');
  const net = gross ? computeNet(gross || 0, validRows.map((r) => r.amount || 0)) : '0.00';
  const deductionsTotal = gross ? (Number(gross) - Number(net)).toFixed(2) : '0.00';
  const netInvalid = gross !== '' && isNegative(net);
  const splitInvalid = source?.scope === 'shared' && split.custom && Math.abs(splitTotal(split) - 100) > 0.001;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (netInvalid || splitInvalid) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        sourceId,
        kind,
        payDate,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        grossAmount: gross,
        currency,
        accountId,
        notes: notes || null,
        deductions: validRows.map(({ deductionTypeId, amount }) => ({ deductionTypeId, amount })),
        splits: source?.scope === 'shared' ? splitsPayload(split) : undefined,
      });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Pago de ingreso">
      <ErrorBanner error={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fuente">
          {(id) => (
            <Select id={id} required value={sourceId} onChange={(e) => changeSource(e.target.value)}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tipo de pago">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as IncomeKind)}>
              {INCOME_KINDS.map((k) => (
                <option key={k} value={k}>
                  {INCOME_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Fecha de pago">{(id) => <Input id={id} type="date" required value={payDate} onChange={(e) => setPayDate(e.target.value)} />}</Field>
        <Field label="Cuenta donde se recibe">{(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}</Field>
        <Field label="Período desde (opcional)">{(id) => <Input id={id} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />}</Field>
        <Field label="Período hasta (opcional)">{(id) => <Input id={id} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />}</Field>
      </div>

      <div className="grid grid-cols-[1fr_7rem] gap-4">
        <Field label="Monto bruto">{(id) => <MoneyInput id={id} required value={gross} onChange={(e) => setGross(e.target.value)} />}</Field>
        <Field label="Moneda">{(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}</Field>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">Descuentos (según tu volante de pago)</legend>
        {rows.length === 0 && <p className="text-xs text-muted">Sin descuentos: el neto será igual al bruto.</p>}
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2">
            <Select
              aria-label="Tipo de descuento"
              value={row.deductionTypeId}
              onChange={(e) => setRows(rows.map((r) => (r.key === row.key ? { ...r, deductionTypeId: e.target.value } : r)))}
            >
              <option value="">Selecciona…</option>
              {usableTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <div className="w-36 shrink-0">
              <MoneyInput
                aria-label="Monto del descuento"
                value={row.amount}
                onChange={(e) => setRows(rows.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r)))}
              />
            </div>
            <IconButton label="Quitar descuento" onClick={() => setRows(rows.filter((r) => r.key !== row.key))} icon={<Trash2 className="size-4" />} />
          </div>
        ))}
        <div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() => setRows([...rows, { key: ++rowKey, deductionTypeId: '', amount: '' }])}
          >
            Agregar descuento
          </Button>
        </div>
      </fieldset>

      <dl className="grid grid-cols-3 gap-2 rounded-lg bg-surface-2 p-3 text-sm" aria-live="polite">
        <div>
          <dt className="text-muted">Bruto</dt>
          <dd className="font-semibold">
            <Money value={gross || 0} currency={currency} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Descuentos</dt>
          <dd className="font-semibold text-danger">
            <Money value={deductionsTotal} currency={currency} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Neto</dt>
          <dd className={netInvalid ? 'font-semibold text-danger' : 'font-semibold text-success'} data-testid="net-amount">
            <Money value={net} currency={currency} />
          </dd>
        </div>
      </dl>
      {netInvalid && <p className="text-sm text-danger">Los descuentos no pueden superar el monto bruto.</p>}

      {source?.scope === 'shared' && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Atribución entre miembros</span>
          <SplitEditor value={split} onChange={setSplit} amount={net} currency={currency} />
        </div>
      )}

      <Field label="Notas">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving} disabled={!sourceId || netInvalid || splitInvalid}>
          Guardar
        </Button>
      </div>
    </form>
  );
};
