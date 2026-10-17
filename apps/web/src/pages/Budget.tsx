import type { BudgetLineKind, Currency, ExpenseNature, Scope } from '@mypersonalfinance/shared';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Copy, Equal, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { CurrencySelect, Money, OwnerBadge, OwnerSelect } from '../components/finance';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  IconButton,
  Modal,
  MoneyInput,
  Notice,
  PageHeader,
  Segmented,
  Select,
  Spinner,
} from '../components/ui';
import { usePrefs } from '../context/prefs';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { useApiMutation, useBudget, useCategories, useGoals, useIncomeSources } from '../lib/queries';
import type { AnnualBudget, BudgetLine, BudgetSuggestions } from '../lib/types';

type Mode = 'plan' | 'actual' | 'diff';
type Group = 'income' | 'fixed' | 'variable' | 'saving';

interface DraftLine {
  key: string;
  kind: BudgetLineKind;
  categoryId: string | null;
  incomeSourceId: string | null;
  goalId: string | null;
  scope: Scope;
  ownerUserId: string | null;
  nature: ExpenseNature | null;
  amounts: string[];
}

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const GROUPS: { id: Group; label: string }[] = [
  { id: 'income', label: 'Ingresos' },
  { id: 'fixed', label: 'Gastos fijos' },
  { id: 'variable', label: 'Gastos corrientes' },
  { id: 'saving', label: 'Ahorro' },
];

let seq = 0;
const nextKey = () => `l${++seq}`;
const groupOf = (l: { kind: BudgetLineKind; nature: ExpenseNature | null }): Group =>
  l.kind === 'expense' ? (l.nature === 'fixed' ? 'fixed' : 'variable') : l.kind;
const identity = (l: Pick<DraftLine, 'kind' | 'categoryId' | 'incomeSourceId' | 'goalId' | 'scope' | 'ownerUserId'>) =>
  l.kind === 'expense' ? `e|${l.categoryId}|${l.scope}|${l.ownerUserId ?? ''}` : l.kind === 'income' ? `i|${l.incomeSourceId}` : `s|${l.goalId}`;
const toDraft = (l: BudgetLine): DraftLine => ({
  key: nextKey(),
  kind: l.kind,
  categoryId: l.categoryId,
  incomeSourceId: l.incomeSourceId,
  goalId: l.goalId,
  scope: l.scope,
  ownerUserId: l.ownerUserId,
  nature: l.nature,
  amounts: [...l.plan],
});
const total = (values: (string | number)[]) => values.reduce<number>((acc, v) => acc + (Number(v) || 0), 0);
/** Grid numbers: no currency symbol (it's in the subtitle) and no cents, to keep 12 months readable. */
const numberFormat = new Intl.NumberFormat('es-DO', { maximumFractionDigits: 0 });
const compact = (v: number, _currency?: Currency) => (Math.round(v) === 0 ? '—' : numberFormat.format(Math.round(v)));

/** Positive when the month went better than planned (more income, less spending). */
const goodness = (kind: BudgetLineKind, plan: number, actual: number) => (kind === 'expense' ? plan - actual : actual - plan);

export const BudgetPage = () => {
  const { month, setMonth, canWrite, me, view, nameOf } = usePrefs();
  const navigate = useNavigate();
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [mode, setMode] = useState<Mode>('plan');
  const budget = useBudget(year);
  const categories = useCategories();
  const sources = useIncomeSources();
  const goals = useGoals();
  const [draft, setDraft] = useState<DraftLine[] | null>(null);
  const [currency, setCurrency] = useState<Currency>(me.defaultCurrency);
  const [adding, setAdding] = useState<Group | null>(null);
  const [filling, setFilling] = useState<DraftLine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = useApiMutation((payload: unknown) => api.put<AnnualBudget>(`/budgets/${year}`, payload), ['budget']);
  const copyPrevious = useApiMutation((adjustPct: number) => api.post(`/budgets/${year}/copy-previous`, { adjustPct }), ['budget']);

  // Leaving the year discards unsaved edits.
  useEffect(() => {
    setDraft(null);
    setNotice(null);
  }, [year]);
  useEffect(() => {
    if (budget.data && !draft) setCurrency(budget.data.currency);
  }, [budget.data, draft]);

  const data = budget.data;
  const lines = useMemo(() => draft ?? data?.lines.map(toDraft) ?? [], [draft, data]);
  const visibleLines = lines.filter((l) => view === 'household' || l.scope === 'shared' || l.ownerUserId === me.id);
  const actualByIdentity = useMemo(() => new Map((data?.lines ?? []).map((l) => [identity(l), l])), [data]);
  const dirty = draft !== null;

  const edit = (key: string, patch: Partial<DraftLine>) => setDraft(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const setAmount = (key: string, m: number, value: string) =>
    setDraft(lines.map((l) => (l.key === key ? { ...l, amounts: l.amounts.map((a, i) => (i === m ? value : a)) } : l)));

  const nameOfLine = (l: DraftLine) =>
    l.kind === 'expense'
      ? (categories.data?.find((c) => c.id === l.categoryId)?.name ?? '—')
      : l.kind === 'income'
        ? (sources.data?.find((s) => s.id === l.incomeSourceId)?.name ?? '—')
        : (goals.data?.find((g) => g.id === l.goalId)?.name ?? '—');
  const colorOf = (l: DraftLine) => (l.kind === 'expense' ? categories.data?.find((c) => c.id === l.categoryId)?.color : null);

  const generate = async () => {
    const res = await api.post<BudgetSuggestions>(`/budgets/${year}/suggestions`);
    const next = [...lines];
    for (const s of res.lines) {
      const existing = next.find((l) => identity(l) === identity(s));
      // Fill the months still empty; keep what the user already planned.
      if (existing) existing.amounts = existing.amounts.map((a, i) => (Number(a) ? a : (s.amounts[i] ?? '0')));
      else next.push({ key: nextKey(), ...s, amounts: [...s.amounts] });
    }
    setDraft(next);
    setNotice(
      [
        `Se agregaron ${res.lines.length} líneas desde gastos fijos e ingresos programados.`,
        res.skippedWithoutCategory ? `${res.skippedWithoutCategory} gasto(s) fijo(s) sin categoría no se incluyeron.` : '',
        res.missingRates.length ? `Faltan tasas: ${res.missingRates.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  };

  const submit = async () => {
    await save.mutateAsync({
      currency,
      lines: lines.map(({ kind, categoryId, incomeSourceId, goalId, scope, ownerUserId, nature, amounts }) => ({
        kind,
        categoryId,
        incomeSourceId,
        goalId,
        scope,
        ownerUserId,
        nature,
        amounts: amounts.map((a) => (a === '' ? '0' : a)),
      })),
    });
    setDraft(null);
    setNotice(null);
  };

  const openMonth = (m: number, kind: BudgetLineKind) => {
    setMonth(`${year}-${String(m + 1).padStart(2, '0')}`);
    navigate(kind === 'income' ? '/ingresos' : kind === 'saving' ? '/metas' : '/gastos');
  };

  if (budget.isLoading || !data) return <Spinner />;
  const cur = data.currency;
  const thisYear = Number(new Date().toISOString().slice(0, 4));
  const elapsed = year < thisYear ? 12 : year > thisYear ? 0 : new Date().getMonth() + 1;
  const ytd = (values: string[]) => total(values.slice(0, elapsed));
  const t = data.totals;
  const planIncome = total(lines.filter((l) => l.kind === 'income').flatMap((l) => l.amounts));
  const planExpense = total(lines.filter((l) => l.kind === 'expense').flatMap((l) => l.amounts));
  const planSaving = total(lines.filter((l) => l.kind === 'saving').flatMap((l) => l.amounts));

  /** One cell of the grid, depending on the mode. */
  const cell = (l: DraftLine, m: number) => {
    const plan = Number(l.amounts[m]) || 0;
    const actual = Number(actualByIdentity.get(identity(l))?.actual[m] ?? 0);
    if (mode === 'plan') {
      return canWrite ? (
        <input
          aria-label={`${nameOfLine(l)} ${MONTH_LABELS[m]}`}
          inputMode="decimal"
          className="tabular h-8 w-full min-w-20 rounded-md border border-transparent bg-transparent px-1.5 text-right text-sm hover:border-border focus:border-primary focus:outline-none"
          value={(l.amounts[m] ?? '').replace(/\.00$/, '').replace(/^0$/, '')}
          placeholder="—"
          onChange={(e) => setAmount(l.key, m, e.target.value.replace(/[^\d.]/g, ''))}
        />
      ) : (
        <span className="tabular px-1.5">{compact(plan, cur)}</span>
      );
    }
    // Differences only make sense for months that already happened.
    const value = mode === 'actual' ? actual : m < elapsed ? actual - plan : 0;
    const good = goodness(l.kind, plan, actual);
    return (
      <button
        type="button"
        onClick={() => openMonth(m, l.kind)}
        title="Ver movimientos del mes"
        className={clsx(
          'tabular w-full rounded-md px-1.5 py-1 text-right hover:bg-surface-2',
          mode === 'diff' && value !== 0 && (good >= 0 ? 'text-success' : 'text-danger'),
          mode === 'actual' && plan > 0 && actual > plan && l.kind === 'expense' && 'text-danger',
        )}
      >
        {mode === 'diff' && value > 0 ? '+' : ''}
        {compact(value, cur)}
      </button>
    );
  };

  const rowTotal = (l: DraftLine) => {
    const months = mode === 'diff' ? elapsed : 12;
    const plan = total(l.amounts.slice(0, months));
    const actual = total((actualByIdentity.get(identity(l))?.actual ?? []).slice(0, months));
    const value = mode === 'plan' ? total(l.amounts) : mode === 'actual' ? actual : actual - plan;
    return (
      <span className={clsx('tabular font-medium', mode === 'diff' && value !== 0 && (goodness(l.kind, plan, actual) >= 0 ? 'text-success' : 'text-danger'))}>
        {compact(value, cur)}
      </span>
    );
  };

  const groupRow = (group: Group, rows: DraftLine[]) => {
    const kind: BudgetLineKind = group === 'income' ? 'income' : group === 'saving' ? 'saving' : 'expense';
    const values = Array.from({ length: 12 }, (_, m) => {
      const plan = total(rows.map((l) => l.amounts[m] ?? 0));
      const actual = total(rows.map((l) => actualByIdentity.get(identity(l))?.actual[m] ?? 0));
      return mode === 'plan' ? plan : mode === 'actual' ? actual : m < elapsed ? actual - plan : 0;
    });
    return { values, kind };
  };

  const grid: ReactNode = (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[1100px] whitespace-nowrap text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted">
            <th className="sticky left-0 z-10 min-w-56 border-b border-border bg-surface px-3 py-2 text-left font-medium">Línea ({cur})</th>
            {MONTH_LABELS.map((label, m) => (
              <th key={label} className={clsx('border-b border-border px-1.5 py-2 text-right font-medium', m < elapsed && 'text-text')}>
                {label}
              </th>
            ))}
            <th className="border-b border-border px-3 py-2 text-right font-medium">Total</th>
            {mode === 'plan' && canWrite && <th className="border-b border-border" />}
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((g) => {
            const rows = visibleLines.filter((l) => groupOf(l) === g.id);
            const { values: sums, kind } = groupRow(g.id, rows);
            const tone = (v: number) => mode === 'diff' && v !== 0 && ((kind === 'expense' ? -v : v) >= 0 ? 'text-success' : 'text-danger');
            return [
              <tr key={`${g.id}-header`} className="bg-surface-2">
                <td className="sticky left-0 z-10 bg-surface-2 px-3 py-2 font-semibold">
                  <div className="flex items-center justify-between gap-2">
                    {g.label}
                    {mode === 'plan' && canWrite && (
                      <IconButton label={`Agregar a ${g.label}`} onClick={() => setAdding(g.id)} icon={<Plus className="size-4" />} />
                    )}
                  </div>
                </td>
                {sums.map((v, m) => (
                  <td key={m} className={clsx('tabular px-1.5 py-2 text-right font-semibold', tone(v))}>
                    {compact(v, cur)}
                  </td>
                ))}
                <td className={clsx('tabular px-3 py-2 text-right font-semibold', tone(total(sums)))}>{compact(total(sums), cur)}</td>
                {mode === 'plan' && canWrite && <td />}
              </tr>,
              ...rows.map((l) => (
                <tr key={l.key} className="border-t border-border">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-1">
                    <div className="flex items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(l) ?? 'var(--muted)' }} aria-hidden />
                      <span className="truncate">{nameOfLine(l)}</span>
                      {l.scope === 'personal' && <span className="truncate text-xs text-muted">· {nameOf(l.ownerUserId)}</span>}
                    </div>
                  </td>
                  {Array.from({ length: 12 }, (_, m) => (
                    <td key={m} className="px-0.5 py-0.5 text-right">
                      {cell(l, m)}
                    </td>
                  ))}
                  <td className="px-3 py-1 text-right">{rowTotal(l)}</td>
                  {mode === 'plan' && canWrite && (
                    <td className="whitespace-nowrap pr-2 text-right">
                      <IconButton label="Rellenar la fila" onClick={() => setFilling(l)} icon={<Equal className="size-4" />} />
                      <IconButton label="Quitar línea" onClick={() => setDraft(lines.filter((x) => x.key !== l.key))} icon={<Trash2 className="size-4" />} />
                    </td>
                  )}
                </tr>
              )),
              rows.length === 0 && (
                <tr key={`${g.id}-empty`} className="border-t border-border">
                  <td colSpan={15} className="px-3 py-2 text-xs text-muted">
                    Sin líneas.
                  </td>
                </tr>
              ),
            ];
          })}
          {mode !== 'plan' && data.unbudgeted.length > 0 && (
            <>
              <tr className="bg-surface-2">
                <td colSpan={15} className="sticky left-0 px-3 py-2 font-semibold">
                  Fuera del presupuesto
                </td>
              </tr>
              {data.unbudgeted
                .filter((u) => view === 'household' || u.scope === 'shared' || u.ownerUserId === me.id)
                .map((u) => (
                  <tr key={`${u.categoryId}-${u.scope}-${u.ownerUserId}`} className="border-t border-border">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-1">
                      <span className="truncate">{u.name}</span> <OwnerBadge scope={u.scope} ownerUserId={u.ownerUserId} />
                    </td>
                    {u.actual.map((v, m) => (
                      <td key={m} className="tabular px-1.5 py-1 text-right text-warning">
                        {compact(Number(v), cur)}
                      </td>
                    ))}
                    <td className="tabular px-3 py-1 text-right font-medium text-warning">{compact(Number(u.actualTotal), cur)}</td>
                  </tr>
                ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHeader
        title={`Presupuesto ${year}`}
        subtitle={`Plan anual vs real, mes a mes · montos en ${cur}`}
        actions={
          <>
            <div className="flex items-center gap-1">
              <IconButton label="Año anterior" onClick={() => setYear(year - 1)} icon={<ChevronLeft className="size-4" />} />
              <span className="tabular w-14 text-center font-semibold">{year}</span>
              <IconButton label="Año siguiente" onClick={() => setYear(year + 1)} icon={<ChevronRight className="size-4" />} />
            </div>
            <Segmented<Mode>
              ariaLabel="Vista del presupuesto"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'plan', label: 'Plan' },
                { value: 'actual', label: 'Real' },
                { value: 'diff', label: 'Diferencia' },
              ]}
            />
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Ingresos a la fecha', actual: ytd(t.income.actual), plan: ytd(t.income.plan), kind: 'income' as const },
          { label: 'Gastos a la fecha', actual: ytd(t.expense.actual), plan: ytd(t.expense.plan), kind: 'expense' as const },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-sm text-muted">{k.label}</p>
            <p className="mt-1 text-xl font-semibold">
              <Money value={k.actual} currency={cur} />
            </p>
            <p className={clsx('text-xs', goodness(k.kind, k.plan, k.actual) >= 0 ? 'text-success' : 'text-danger')}>
              Plan {formatMoney(k.plan, cur)} · {goodness(k.kind, k.plan, k.actual) >= 0 ? 'mejor' : 'peor'} por{' '}
              {formatMoney(Math.abs(k.actual - k.plan), cur)}
            </p>
          </Card>
        ))}
        <Card className="p-4">
          <p className="text-sm text-muted">Ahorro proyectado del año</p>
          <p className={clsx('mt-1 text-xl font-semibold', planIncome - planExpense >= 0 ? 'text-success' : 'text-danger')}>
            <Money value={planIncome - planExpense} currency={cur} />
          </p>
          <p className="text-xs text-muted">Ingresos − gastos planificados; metas: {formatMoney(planSaving, cur)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted">Gastos planificados del año</p>
          <p className="mt-1 text-xl font-semibold">
            <Money value={planExpense} currency={cur} />
          </p>
          <p className="text-xs text-muted">Real en el año: {formatMoney(t.expense.actualTotal, cur)}</p>
        </Card>
      </div>

      {canWrite && mode === 'plan' && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={<Sparkles className="size-4" />} onClick={generate}>
            Generar desde gastos fijos e ingresos
          </Button>
          {lines.length === 0 && (
            <Button
              variant="secondary"
              icon={<Copy className="size-4" />}
              loading={copyPrevious.isPending}
              onClick={() => {
                const pct = prompt(`¿Ajuste sobre ${year - 1} en %? (0 = igual)`, '0');
                if (pct !== null) copyPrevious.mutate(Number(pct) || 0);
              }}
            >
              Copiar {year - 1}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <label className="text-sm text-muted" htmlFor="budget-currency">
              Moneda
            </label>
            <div className="w-24">
              <CurrencySelect
                id="budget-currency"
                value={currency}
                onChange={(c) => {
                  setCurrency(c);
                  setDraft(lines);
                }}
              />
            </div>
            {dirty && (
              <>
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  Descartar
                </Button>
                <Button loading={save.isPending} onClick={submit}>
                  Guardar cambios
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      <div className="mb-3 flex flex-col gap-2">
        <ErrorBanner error={save.error ?? copyPrevious.error} />
        {notice && <Notice tone="primary">{notice}</Notice>}
        {data.missingRates.length > 0 && <Notice>Faltan tasas de cambio ({data.missingRates.join(', ')}); algunos montos reales no se incluyeron.</Notice>}
      </div>

      {lines.length === 0 && !canWrite ? (
        <Card>
          <EmptyState title={`${year} no tiene presupuesto`} />
        </Card>
      ) : (
        grid
      )}

      <AddLineModal
        group={adding}
        existing={new Set(lines.map(identity))}
        onClose={() => setAdding(null)}
        onAdd={(line) => {
          setDraft([...lines, { key: nextKey(), amounts: Array(12).fill('0'), ...line }]);
          setAdding(null);
        }}
      />
      <FillModal
        line={filling}
        currency={currency}
        name={filling ? nameOfLine(filling) : ''}
        onClose={() => setFilling(null)}
        onApply={(amounts) => {
          if (filling) edit(filling.key, { amounts });
          setFilling(null);
        }}
      />
    </>
  );
};

/** Picks what a new line budgets: a category (with owner), an income source or a goal. */
const AddLineModal = ({
  group,
  existing,
  onClose,
  onAdd,
}: {
  group: Group | null;
  existing: Set<string>;
  onClose: () => void;
  onAdd: (line: Omit<DraftLine, 'key' | 'amounts'>) => void;
}) => {
  const categories = useCategories();
  const sources = useIncomeSources();
  const goals = useGoals();
  const [target, setTarget] = useState('');
  const [owner, setOwner] = useState<{ scope: Scope; ownerUserId: string | null }>({ scope: 'shared', ownerUserId: null });
  useEffect(() => setTarget(''), [group]);
  if (!group) return null;

  const kind: BudgetLineKind = group === 'income' ? 'income' : group === 'saving' ? 'saving' : 'expense';
  const options =
    kind === 'expense'
      ? (categories.data ?? []).filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name }))
      : kind === 'income'
        ? (sources.data ?? []).filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name }))
        : (goals.data ?? []).filter((g) => !g.archived).map((g) => ({ id: g.id, name: g.name }));
  const line = (): Omit<DraftLine, 'key' | 'amounts'> =>
    kind === 'expense'
      ? { kind, categoryId: target, incomeSourceId: null, goalId: null, ...owner, nature: group === 'fixed' ? 'fixed' : 'variable' }
      : kind === 'income'
        ? {
            kind,
            categoryId: null,
            incomeSourceId: target,
            goalId: null,
            scope: sources.data?.find((s) => s.id === target)?.scope ?? 'shared',
            ownerUserId: sources.data?.find((s) => s.id === target)?.ownerUserId ?? null,
            nature: null,
          }
        : {
            kind,
            categoryId: null,
            incomeSourceId: null,
            goalId: target,
            scope: goals.data?.find((g) => g.id === target)?.ownerUserId ? 'personal' : 'shared',
            ownerUserId: goals.data?.find((g) => g.id === target)?.ownerUserId ?? null,
            nature: null,
          };
  const duplicate = Boolean(target) && existing.has(identity(line()));

  return (
    <Modal open onClose={onClose} title={`Agregar a ${GROUPS.find((g) => g.id === group)?.label}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (target && !duplicate) onAdd(line());
        }}
      >
        <Field label={kind === 'expense' ? 'Categoría' : kind === 'income' ? 'Fuente de ingreso' : 'Meta de ahorro'}>
          {(id) => (
            <Select id={id} required value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Selecciona…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {kind === 'expense' && <Field label="De quién">{(id) => <OwnerSelect id={id} value={owner} onChange={setOwner} />}</Field>}
        {duplicate && <Notice>Esa línea ya está en el presupuesto.</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!target || duplicate}>
            Agregar
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/** Fills a whole row: the same amount every month, or an annual total split across months. */
const FillModal = ({
  line,
  name,
  currency,
  onClose,
  onApply,
}: {
  line: DraftLine | null;
  name: string;
  currency: Currency;
  onClose: () => void;
  onApply: (amounts: string[]) => void;
}) => {
  const [how, setHow] = useState<'monthly' | 'annual'>('monthly');
  const [value, setValue] = useState('');
  const [fromMonth, setFromMonth] = useState('1');
  useEffect(() => setValue(''), [line]);
  if (!line) return null;
  const start = Number(fromMonth) - 1;
  const months = 12 - start;
  const amounts = line.amounts.map((a, i) => {
    if (i < start) return a;
    if (how === 'monthly') return value || '0';
    // Annual total split in equal parts; the rounding remainder goes to December.
    const each = Math.floor(((Number(value) || 0) / months) * 100) / 100;
    return i === 11 ? ((Number(value) || 0) - each * (months - 1)).toFixed(2) : each.toFixed(2);
  });

  return (
    <Modal open onClose={onClose} title={`Rellenar "${name}"`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(amounts);
        }}
      >
        <Segmented<'monthly' | 'annual'>
          ariaLabel="Cómo rellenar"
          value={how}
          onChange={setHow}
          options={[
            { value: 'monthly', label: 'Mismo monto cada mes' },
            { value: 'annual', label: 'Repartir un total' },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={how === 'monthly' ? `Monto mensual (${currency})` : `Total a repartir (${currency})`}>
            {(id) => <MoneyInput id={id} required value={value} onChange={(e) => setValue(e.target.value)} />}
          </Field>
          <Field label="Desde">
            {(id) => (
              <Select id={id} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)}>
                {MONTH_LABELS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <p className="text-xs text-muted">Total del año: {formatMoney(total(amounts), currency)}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit">Aplicar</Button>
        </div>
      </form>
    </Modal>
  );
};

