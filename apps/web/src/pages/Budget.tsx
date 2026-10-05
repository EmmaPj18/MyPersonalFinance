import type { Currency, Scope } from '@mypersonalfinance/shared';
import { Copy, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CategorySelect, CurrencySelect, Money, OwnerBadge, OwnerSelect } from '../components/finance';
import { MonthPicker } from '../components/layout/AppLayout';
import { Button, Card, CardHeader, EmptyState, ErrorBanner, IconButton, MoneyInput, Notice, PageHeader, ProgressBar, Spinner, Table, Td, Th } from '../components/ui';
import { usePrefs } from '../context/prefs';
import { api } from '../lib/api';
import { formatMonth, formatPct } from '../lib/format';
import { useApiMutation, useBudget } from '../lib/queries';

interface DraftItem {
  key: string;
  categoryId: string | null;
  scope: Scope;
  ownerUserId: string | null;
  plannedAmount: string;
}

let k = 0;

export const BudgetPage = () => {
  const { month, canWrite, me, view } = usePrefs();
  const budget = useBudget(month);
  const [editing, setEditing] = useState(false);
  const [currency, setCurrency] = useState<Currency>(me.defaultCurrency);
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [error, setError] = useState<unknown>(null);

  const save = useApiMutation((payload: unknown) => api.put(`/budgets/${month}`, payload), ['budget']);
  const copyPrevious = useApiMutation(() => api.post(`/budgets/${month}/copy-previous`), ['budget']);

  useEffect(() => setEditing(false), [month]);

  const startEditing = () => {
    const data = budget.data!;
    setCurrency(data.currency);
    setDraft(
      data.items.map((i) => ({ key: String(++k), categoryId: i.categoryId, scope: i.scope, ownerUserId: i.ownerUserId, plannedAmount: i.plannedAmount })),
    );
    setError(null);
    setEditing(true);
  };

  const applySuggestions = () => {
    const data = budget.data!;
    const next = [...draft];
    for (const s of data.suggestions) {
      const existing = next.find((d) => d.categoryId === s.categoryId && d.scope === s.scope && d.ownerUserId === s.ownerUserId);
      if (existing) existing.plannedAmount = s.amount;
      else next.push({ key: String(++k), ...s, plannedAmount: s.amount });
    }
    setDraft(next);
  };

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        currency,
        items: draft
          .filter((d) => d.categoryId && d.plannedAmount !== '')
          .map(({ categoryId, scope, ownerUserId, plannedAmount }) => ({ categoryId, scope, ownerUserId, plannedAmount })),
      });
      setEditing(false);
    } catch (err) {
      setError(err);
    }
  };

  if (budget.isLoading || !budget.data) return <Spinner />;
  const data = budget.data;
  const items = data.items.filter((i) => view === 'household' || i.scope === 'shared' || i.ownerUserId === me.id);
  const planned = Number(data.totals.planned);
  const used = Number(data.totals.actual) + Number(data.totals.pending);

  return (
    <>
      <PageHeader
        title="Presupuesto"
        subtitle={`${formatMonth(month)} · presupuestado vs real, del hogar y personal.`}
        actions={
          <>
            <MonthPicker />
            {canWrite && !editing && (
              <>
                {!data.budgetId && (
                  <Button variant="secondary" icon={<Copy className="size-4" />} loading={copyPrevious.isPending} onClick={() => copyPrevious.mutate()}>
                    Copiar mes anterior
                  </Button>
                )}
                <Button onClick={startEditing}>{data.budgetId ? 'Editar presupuesto' : 'Crear presupuesto'}</Button>
              </>
            )}
          </>
        }
      />
      <ErrorBanner error={copyPrevious.error} />
      {data.missingRates.length > 0 && (
        <div className="mb-4">
          <Notice>Faltan tasas de cambio ({data.missingRates.join(', ')}); algunos gastos no se incluyeron.</Notice>
        </div>
      )}

      {editing ? (
        <Card>
          <CardHeader
            title="Editar presupuesto"
            actions={
              <>
                <div className="w-24">
                  <CurrencySelect value={currency} onChange={setCurrency} />
                </div>
                {data.suggestions.length > 0 && (
                  <Button variant="secondary" size="sm" icon={<Sparkles className="size-4" />} onClick={applySuggestions}>
                    Usar gastos fijos
                  </Button>
                )}
              </>
            }
          />
          <div className="flex flex-col gap-2 p-4 sm:p-5">
            <ErrorBanner error={error} />
            {draft.map((d) => (
              <div key={d.key} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_10rem_auto]">
                <CategorySelect ariaLabel="Categoría" value={d.categoryId} onChange={(categoryId) => setDraft(draft.map((x) => (x.key === d.key ? { ...x, categoryId } : x)))} />
                <OwnerSelect
                  ariaLabel="De quién"
                  value={d}
                  onChange={(o) => setDraft(draft.map((x) => (x.key === d.key ? { ...x, ...o } : x)))}
                />
                <MoneyInput
                  aria-label="Monto presupuestado"
                  value={d.plannedAmount}
                  onChange={(e) => setDraft(draft.map((x) => (x.key === d.key ? { ...x, plannedAmount: e.target.value } : x)))}
                />
                <IconButton label="Quitar" onClick={() => setDraft(draft.filter((x) => x.key !== d.key))} icon={<Trash2 className="size-4" />} />
              </div>
            ))}
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus className="size-4" />}
                onClick={() => setDraft([...draft, { key: String(++k), categoryId: null, scope: 'shared', ownerUserId: null, plannedAmount: '' }])}
              >
                Agregar partida
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
                <Button loading={save.isPending} onClick={submit}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : !data.budgetId ? (
        <Card>
          <EmptyState
            title="Este mes no tiene presupuesto"
            description="Crea uno desde cero, copia el del mes anterior o parte de tus gastos fijos."
          />
        </Card>
      ) : (
        <>
          <Card className="mb-6 p-4">
            <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
              <span>
                Usado <Money value={used} currency={data.currency} className="font-semibold" /> de{' '}
                <Money value={planned} currency={data.currency} className="font-semibold" />
              </span>
              <span className="text-muted">{planned ? formatPct((used / planned) * 100) : '—'}</span>
            </div>
            <ProgressBar value={planned ? (used / planned) * 100 : 0} tone={used > planned ? 'danger' : 'primary'} />
          </Card>
          <Card>
            <Table>
              <thead>
                <tr>
                  <Th>Categoría</Th>
                  <Th>De</Th>
                  <Th className="text-right">Presupuestado</Th>
                  <Th className="text-right">Pagado</Th>
                  <Th className="text-right">Pendiente</Th>
                  <Th className="text-right">Restante</Th>
                  <Th className="w-40">Avance</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const pct = Number(i.plannedAmount) ? ((Number(i.actual) + Number(i.pending)) / Number(i.plannedAmount)) * 100 : 0;
                  return (
                    <tr key={i.id}>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-2 rounded-full" style={{ background: i.color ?? 'var(--muted)' }} aria-hidden />
                          {i.categoryName}
                          <span className="text-xs text-muted">· {i.nature === 'fixed' ? 'fijo' : 'corriente'}</span>
                        </span>
                      </Td>
                      <Td>
                        <OwnerBadge scope={i.scope} ownerUserId={i.ownerUserId} />
                      </Td>
                      <Td className="text-right">
                        <Money value={i.plannedAmount} currency={data.currency} />
                      </Td>
                      <Td className="text-right">
                        <Money value={i.actual} currency={data.currency} />
                      </Td>
                      <Td className="text-right text-warning">
                        {Number(i.pending) > 0 ? <Money value={i.pending} currency={data.currency} /> : '—'}
                      </Td>
                      <Td className={`text-right font-medium ${Number(i.remaining) < 0 ? 'text-danger' : ''}`}>
                        <Money value={i.remaining} currency={data.currency} />
                      </Td>
                      <Td>
                        <ProgressBar value={pct} tone={pct > 100 ? 'danger' : pct > 85 ? 'warning' : 'primary'} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
          {data.unbudgeted.length > 0 && (
            <Card className="mt-6">
              <CardHeader title="Gastos fuera del presupuesto" />
              <ul className="divide-y divide-border">
                {data.unbudgeted.map((u) => (
                  <li key={`${u.categoryId}-${u.scope}-${u.ownerUserId}`} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                    <span className="flex-1">{u.categoryName}</span>
                    <OwnerBadge scope={u.scope} ownerUserId={u.ownerUserId} />
                    <Money value={Number(u.actual) + Number(u.pending)} currency={data.currency} className="w-32 text-right" />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
};
