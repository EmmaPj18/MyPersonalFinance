import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router';
import { Money } from '../components/finance';
import { MonthPicker } from '../components/layout/AppLayout';
import { Card, CardHeader, EmptyState, Notice, PageHeader, ProgressBar, Spinner } from '../components/ui';
import { usePrefs } from '../context/prefs';
import { formatMoney, formatMonth, formatPct } from '../lib/format';
import { useBudget, useDebts, useGoals, useMonthlyReport, useYearlyReport } from '../lib/queries';

const SERIES = { income: '#22c55e', expenses: '#f43f5e', gross: '#818cf8' };

const Kpi = ({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: string }) => (
  <Card className="p-4">
    <p className="text-sm text-muted">{label}</p>
    <p className={`mt-1 text-xl font-semibold ${tone ?? ''}`}>{value}</p>
    {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
  </Card>
);

export const DashboardPage = () => {
  const { month, currency, view, nameOf } = usePrefs();
  const report = useMonthlyReport(month, currency, view);
  const year = useYearlyReport(Number(month.slice(0, 4)), currency, view);
  const budget = useBudget(Number(month.slice(0, 4)));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const goals = useGoals();
  const debts = useDebts();
  const money = (v: string | number) => formatMoney(v, currency);

  if (report.isLoading) return <Spinner />;
  const r = report.data;
  if (!r) return null;
  const netFlow = Number(r.netFlow);

  return (
    <>
      <PageHeader
        title={view === 'household' ? 'Resumen del hogar' : 'Mis finanzas'}
        subtitle={`${formatMonth(month)} · montos en ${currency}`}
        actions={<MonthPicker />}
      />

      {r.missingRates.length > 0 && (
        <div className="mb-4">
          <Notice>
            Faltan tasas de cambio para {r.missingRates.join(', ')}. Agrégalas en{' '}
            <Link className="underline" to="/configuracion">
              Configuración → Tasas de cambio
            </Link>{' '}
            para incluir esos montos.
          </Notice>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Ingreso bruto"
          value={<Money value={r.income.gross} currency={currency} />}
          hint={`Descuentos ${money(r.income.deductions)} (${formatPct(r.income.effectiveDeductionRate)})`}
        />
        <Kpi label="Ingreso neto" value={<Money value={r.income.net} currency={currency} />} tone="text-success" />
        <Kpi
          label="Gastos"
          value={<Money value={r.expenses.total} currency={currency} />}
          hint={`Fijos ${money(r.expenses.fixed)} · Corrientes ${money(r.expenses.variable)}`}
          tone="text-danger"
        />
        <Kpi
          label="Flujo neto"
          value={<Money value={r.netFlow} currency={currency} />}
          hint={`Tasa de ahorro ${formatPct(r.savingsRate)}${Number(r.expenses.pending) > 0 ? ` · ${money(r.expenses.pending)} pendiente` : ''}`}
          tone={netFlow >= 0 ? 'text-success' : 'text-danger'}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={`Ingresos vs gastos ${month.slice(0, 4)}`} />
          <div className="h-72 px-2 py-4">
            {year.data && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={year.data.months.map((m) => ({ ...m, label: formatMonth(m.month).slice(0, 3), net: +m.net, expenses: +m.expenses }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="currentColor" />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={70} stroke="currentColor" tickFormatter={(v) => Intl.NumberFormat('es-DO', { notation: 'compact' }).format(v)} />
                  <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  <Legend />
                  <Bar isAnimationActive={false} dataKey="net" name="Ingreso neto" fill={SERIES.income} radius={[4, 4, 0, 0]} />
                  <Bar isAnimationActive={false} dataKey="expenses" name="Gastos" fill={SERIES.expenses} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Gastos por categoría" />
          {r.expenses.byCategory.length === 0 ? (
            <EmptyState title="Sin gastos este mes" />
          ) : (
            <div className="px-4 pb-4">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie isAnimationActive={false} data={r.expenses.byCategory.map((c) => ({ name: c.name, value: +c.total, color: c.color ?? '#94a3b8' }))} dataKey="value" innerRadius={45} outerRadius={75} paddingAngle={2}>
                      {r.expenses.byCategory.map((c) => (
                        <Cell key={c.name} fill={c.color ?? '#94a3b8'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="flex flex-col gap-1.5 text-sm">
                {r.expenses.byCategory.slice(0, 6).map((c) => (
                  <li key={c.name} className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: c.color ?? '#94a3b8' }} aria-hidden />
                    <span className="flex-1 truncate">{c.name}</span>
                    <Money value={c.total} currency={currency} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Ingresos por fuente" subtitle="Bruto → neto" />
          {r.income.bySource.length === 0 ? (
            <EmptyState title="Sin ingresos este mes" />
          ) : (
            <ul className="divide-y divide-border">
              {r.income.bySource.map((s) => (
                <li key={s.sourceId} className="px-4 py-2.5 text-sm sm:px-5">
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-medium">{s.name}</span>
                    <Money value={s.net} currency={currency} className="font-medium" />
                  </div>
                  <p className="text-xs text-muted">
                    {s.scope === 'shared' ? 'Hogar' : nameOf(s.ownerUserId)} · bruto {money(s.gross)} · descuentos {money(s.deductions)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {view === 'household' && r.income.byPerson.length > 1 && (
            <div className="border-t border-border px-4 py-3 text-sm sm:px-5">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Neto por persona</p>
              {r.income.byPerson.map((p) => (
                <div key={p.userId} className="flex justify-between">
                  <span>{nameOf(p.userId)}</span>
                  <Money value={p.net} currency={currency} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Presupuesto del mes"
            subtitle={
              budget.data?.planId
                ? `${money(budget.data.totals.expense.actual[monthIndex] ?? 0)} de ${money(budget.data.totals.expense.plan[monthIndex] ?? 0)} (${budget.data.currency})`
                : undefined
            }
          />
          {!budget.data?.lines.some((l) => l.kind === 'expense') ? (
            <EmptyState
              title="Sin presupuesto este año"
              action={
                <Link to="/presupuesto" className="text-sm font-medium text-primary">
                  Crear presupuesto
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col gap-3 px-4 py-3 sm:px-5">
              {budget.data.lines
                .filter((l) => l.kind === 'expense' && Number(l.plan[monthIndex]) > 0)
                .sort((a, b) => Number(b.plan[monthIndex]) - Number(a.plan[monthIndex]))
                .slice(0, 6)
                .map((l) => {
                  const pct = (Number(l.actual[monthIndex]) / Number(l.plan[monthIndex])) * 100;
                  return (
                    <li key={l.id} className="text-sm">
                      <div className="mb-1 flex justify-between gap-2">
                        <span className="truncate">{l.name}</span>
                        <span className="tabular text-muted">{formatPct(pct)}</span>
                      </div>
                      <ProgressBar value={pct} tone={pct > 100 ? 'danger' : pct > 85 ? 'warning' : 'primary'} />
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Metas y deudas" />
          <ul className="flex flex-col gap-3 px-4 py-3 text-sm sm:px-5">
            {(goals.data ?? [])
              .filter((g) => !g.archived)
              .slice(0, 3)
              .map((g) => (
                <li key={g.id}>
                  <div className="mb-1 flex justify-between gap-2">
                    <span className="truncate">{g.name}</span>
                    <span className="tabular text-muted">{formatPct(g.progressPct)}</span>
                  </div>
                  <ProgressBar value={Number(g.progressPct)} tone="success" />
                </li>
              ))}
            {(debts.data ?? [])
              .filter((d) => !d.archived)
              .slice(0, 3)
              .map((d) => (
                <li key={d.id} className="flex justify-between gap-2">
                  <span className="truncate">{d.name}</span>
                  <Money value={d.balance} currency={d.currency} className="text-danger" />
                </li>
              ))}
            {!goals.data?.length && !debts.data?.length && <li className="text-muted">Sin metas ni deudas registradas.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
};
