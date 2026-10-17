import { occurrencesPerYear, type Currency, type ExpenseNature, type Scope } from '@mypersonalfinance/shared';
import { CalendarClock, CheckCircle2, Pencil, Plus, Repeat, Trash2, UserRoundCog, Zap } from 'lucide-react';
import { useState } from 'react';
import { Money, OwnerBadge } from '../components/finance';
import { MonthPicker } from '../components/layout/AppLayout';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  Modal,
  PageHeader,
  Segmented,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui';
import { usePrefs } from '../context/prefs';
import { api } from '../lib/api';
import { formatDate, formatMoney, formatMonth, formatShortDate, RECURRENCE_LABELS } from '../lib/format';
import { useAccounts, useApiMutation, useCategories, useExpenses, useRecurringExpenses, useUpcomingExpenses } from '../lib/queries';
import type { Expense, RecurringExpense } from '../lib/types';
import { ExpenseForm, PayForm, ReassignForm, RecurringForm } from './expenses/forms';

type Tab = 'movements' | 'fixed';
type NatureFilter = 'all' | ExpenseNature;
type ScopeFilter = 'all' | Scope;

type ModalState =
  | { kind: 'expense'; expense?: Expense; nature?: ExpenseNature }
  | { kind: 'pay'; expense: Expense }
  | { kind: 'reassign'; expense: Expense }
  | { kind: 'recurring'; template?: RecurringExpense; fromExpense?: Expense }
  | { kind: 'reassign-recurring'; template: RecurringExpense }
  | null;

const ExpenseTable = ({ expenses, onAction }: { expenses: Expense[]; onAction: (m: ModalState) => void }) => {
  const { nameOf, canWrite, me, isOwner } = usePrefs();
  const remove = useApiMutation((id: string) => api.del(`/expenses/${id}`), ['expenses']);
  const editable = (e: Expense) => canWrite && (isOwner || e.scope === 'shared' || e.ownerUserId === me.id);

  return (
    <Table>
      <thead>
        <tr>
          <Th>Fecha</Th>
          <Th>Descripción</Th>
          <Th>Categoría</Th>
          <Th>De</Th>
          <Th>Pagó</Th>
          <Th className="text-right">Monto</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {expenses.map((e) => (
          <tr key={e.id}>
            <Td className="whitespace-nowrap">{formatDate(e.date)}</Td>
            <Td>
              <span className="font-medium">{e.description}</span>{' '}
              <span className="inline-flex flex-wrap gap-1 align-middle">
                {e.nature === 'fixed' && <Badge>Fijo</Badge>}
                {e.status === 'pending' && <Badge tone="warning">Pendiente</Badge>}
                {e.isEstimated && <Badge tone="warning">Estimado</Badge>}
              </span>
            </Td>
            <Td>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: e.categoryColor ?? 'var(--muted)' }} aria-hidden />
                {e.categoryName ?? 'Sin categoría'}
              </span>
            </Td>
            <Td>
              <span
                title={e.splits.map((s) => `${nameOf(s.userId)}: ${Number(s.sharePct)}% (${formatMoney(s.shareAmount ?? 0, e.currency)})`).join('\n')}
              >
                <OwnerBadge scope={e.scope} ownerUserId={e.ownerUserId} />
              </span>
            </Td>
            <Td className="text-muted">{e.status === 'paid' ? nameOf(e.paidByUserId) : '—'}</Td>
            <Td className="text-right font-medium">
              <Money value={e.amount} currency={e.currency} />
            </Td>
            <Td className="text-right whitespace-nowrap">
              {editable(e) && (
                <>
                  {(e.status === 'pending' || e.isEstimated) && (
                    <IconButton
                      label={e.status === 'pending' ? 'Marcar como pagado' : 'Confirmar monto real'}
                      onClick={() => onAction({ kind: 'pay', expense: e })}
                      icon={<CheckCircle2 className="size-4" />}
                    />
                  )}
                  {!e.recurringExpenseId && (
                    <IconButton
                      label="Convertir en gasto fijo"
                      onClick={() => onAction({ kind: 'recurring', fromExpense: e })}
                      icon={<Repeat className="size-4" />}
                    />
                  )}
                  <IconButton label="Cambiar dueño" onClick={() => onAction({ kind: 'reassign', expense: e })} icon={<UserRoundCog className="size-4" />} />
                  <IconButton label="Editar" onClick={() => onAction({ kind: 'expense', expense: e })} icon={<Pencil className="size-4" />} />
                  <IconButton label="Eliminar" onClick={() => confirm('¿Eliminar este gasto?') && remove.mutate(e.id)} icon={<Trash2 className="size-4" />} />
                </>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

/** Monthly-equivalent total per currency of the active fixed expenses. */
const monthlyCommitted = (templates: RecurringExpense[]) => {
  const totals = new Map<Currency, number>();
  for (const t of templates) {
    if (!t.active) continue;
    totals.set(t.currency, (totals.get(t.currency) ?? 0) + (Number(t.amount) * occurrencesPerYear[t.frequency]) / 12);
  }
  return [...totals.entries()];
};

const FixedExpenses = ({ onAction }: { onAction: (m: ModalState) => void }) => {
  const { canWrite, isOwner, me, view, nameOf } = usePrefs();
  const templates = useRecurringExpenses();
  const upcoming = useUpcomingExpenses(30);
  const accounts = useAccounts();
  const remove = useApiMutation((id: string) => api.del(`/recurring-expenses/${id}`), ['recurring-expenses', 'expenses']);
  const visible = (templates.data ?? []).filter((t) => view === 'household' || t.scope === 'shared' || t.ownerUserId === me.id);
  const accountName = (id: string | null) => accounts.data?.find((a) => a.id === id)?.name;

  if (templates.isLoading) return <Spinner />;
  if (visible.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Sin gastos fijos"
          description="Alquiler, servicios, colegio, préstamos… Créalos una vez y se registran solos en cada fecha."
          action={canWrite && <Button onClick={() => onAction({ kind: 'recurring' })}>Crear gasto fijo</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          {monthlyCommitted(visible).map(([currency, total]) => (
            <Card key={currency} className="flex-1 p-4">
              <p className="text-sm text-muted">Comprometido al mes ({currency})</p>
              <p className="mt-1 text-xl font-semibold">
                <Money value={total.toFixed(2)} currency={currency} />
              </p>
            </Card>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((t) => (
            <Card key={t.id} className={`p-4 ${t.active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.name}</p>
                  <p className="text-xs text-muted">
                    {RECURRENCE_LABELS[t.frequency]}
                    {t.frequency !== 'weekly' && t.frequency !== 'biweekly' && ` · día ${t.dueDay}${t.secondDueDay ? ` y ${t.secondDueDay}` : ''}`}
                    {t.categoryName && ` · ${t.categoryName}`}
                  </p>
                </div>
                <Money value={t.amount} currency={t.currency} className="font-semibold" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                <OwnerBadge scope={t.scope} ownerUserId={t.ownerUserId} />
                {t.autoPay ? (
                  <Badge tone="primary">
                    <Zap className="size-3" aria-hidden /> Automático
                  </Badge>
                ) : (
                  <Badge>Confirmación manual</Badge>
                )}
                {t.isVariableAmount && <Badge tone="warning">Monto variable</Badge>}
                {!t.active && <Badge>Pausado</Badge>}
              </div>
              <p className="mt-2 text-xs text-muted">
                {t.nextDate ? `Próximo: ${formatDate(t.nextDate)}` : 'Sin próximas fechas'}
                {t.paidByUserId && ` · lo paga ${nameOf(t.paidByUserId)}`}
                {accountName(t.accountId) && ` · ${accountName(t.accountId)}`}
              </p>
              {canWrite && (isOwner || t.scope === 'shared' || t.ownerUserId === me.id) && (
                <div className="mt-2 flex justify-end">
                  <IconButton label="Cambiar dueño" onClick={() => onAction({ kind: 'reassign-recurring', template: t })} icon={<UserRoundCog className="size-4" />} />
                  <IconButton label="Editar" onClick={() => onAction({ kind: 'recurring', template: t })} icon={<Pencil className="size-4" />} />
                  <IconButton
                    label="Eliminar"
                    onClick={() => confirm(`¿Eliminar "${t.name}"? Los pagos ya registrados se conservan.`) && remove.mutate(t.id)}
                    icon={<Trash2 className="size-4" />}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
      <Card className="self-start">
        <CardHeader title="Próximos 30 días" />
        {!upcoming.data?.length ? (
          <EmptyState title="Nada programado" />
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.data
              .filter((u) => view === 'household' || u.scope === 'shared' || u.ownerUserId === me.id)
              .map((u) => (
                <li key={`${u.recurringExpenseId}-${u.date}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <CalendarClock className="size-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{u.name}</p>
                    <p className="text-xs text-muted">
                      {formatShortDate(u.date)}
                      {u.isVariableAmount && ' · estimado'}
                    </p>
                  </div>
                  <Money value={u.amount} currency={u.currency} />
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export const ExpensesPage = () => {
  const { month, view, me, members, canWrite } = usePrefs();
  const [tab, setTab] = useState<Tab>('movements');
  const [nature, setNature] = useState<NatureFilter>('all');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [person, setPerson] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [applyTo, setApplyTo] = useState<'future' | 'all'>('future');
  const categories = useCategories();

  const expenses = useExpenses({
    month,
    nature: nature === 'all' ? undefined : nature,
    scope: scope === 'all' ? undefined : scope,
    ownerUserId: person || undefined,
    categoryId: categoryId || undefined,
  });

  const close = () => setModal(null);
  const saveExpense = useApiMutation(
    ({ id, payload }: { id?: string; payload: unknown }) => (id ? api.put(`/expenses/${id}`, payload) : api.post('/expenses', payload)),
    ['expenses'],
  );
  const pay = useApiMutation(({ id, payload }: { id: string; payload: unknown }) => api.post(`/expenses/${id}/pay`, payload), ['expenses']);
  const reassign = useApiMutation(
    ({ id, payload }: { id: string; payload: unknown }) => api.post(`/expenses/${id}/reassign`, payload),
    ['expenses', 'expense-history'],
  );
  const saveTemplate = useApiMutation(
    ({ id, payload }: { id?: string; payload: unknown }) =>
      id ? api.put(`/recurring-expenses/${id}`, payload) : api.post('/recurring-expenses', payload),
    ['recurring-expenses', 'expenses'],
  );
  const reassignTemplate = useApiMutation(
    ({ id, payload, apply }: { id: string; payload: unknown; apply: string }) =>
      api.post(`/recurring-expenses/${id}/reassign`, payload, { apply }),
    ['recurring-expenses', 'expenses'],
  );

  // "Mis finanzas": my personal expenses + the shared ones.
  const rows = (expenses.data ?? []).filter((e) => view === 'household' || e.scope === 'shared' || e.ownerUserId === me.id);
  const total = rows.reduce((acc, e) => acc.set(e.currency, (acc.get(e.currency) ?? 0) + Number(e.amount)), new Map<Currency, number>());

  return (
    <>
      <PageHeader
        title="Gastos"
        subtitle="Gastos corrientes y fijos, del hogar o personales."
        actions={
          <>
            {tab === 'movements' && <MonthPicker />}
            {canWrite && tab === 'movements' && (
              <Button icon={<Plus className="size-4" />} onClick={() => setModal({ kind: 'expense' })}>
                Nuevo gasto
              </Button>
            )}
            {canWrite && tab === 'fixed' && (
              <Button icon={<Plus className="size-4" />} onClick={() => setModal({ kind: 'recurring' })}>
                Nuevo gasto fijo
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<Tab>
          ariaLabel="Sección de gastos"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'movements', label: 'Movimientos' },
            { value: 'fixed', label: 'Gastos fijos' },
          ]}
        />
        {tab === 'movements' && (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<NatureFilter>
              ariaLabel="Tipo de gasto"
              size="sm"
              value={nature}
              onChange={setNature}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'fixed', label: 'Fijos' },
                { value: 'variable', label: 'Corrientes' },
              ]}
            />
            <Segmented<ScopeFilter>
              ariaLabel="Común o personal"
              size="sm"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'shared', label: 'Del hogar' },
                { value: 'personal', label: 'Personales' },
              ]}
            />
            {scope === 'personal' && (
              <Select aria-label="Persona" className="!h-8 !w-auto text-xs" value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="">Todas las personas</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
            <Select aria-label="Categoría" className="!h-8 !w-auto text-xs" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Todas las categorías</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {tab === 'movements' && (
        <Card>
          <CardHeader
            title={`Gastos de ${formatMonth(month)}`}
            subtitle={[...total.entries()].map(([c, v]) => formatMoney(v, c)).join(' · ') || undefined}
          />
          {expenses.isLoading ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <EmptyState title="Sin gastos" description="Registra tus gastos del día a día; los fijos aparecen solos en su fecha." />
          ) : (
            <ExpenseTable expenses={rows} onAction={setModal} />
          )}
        </Card>
      )}

      {tab === 'fixed' && <FixedExpenses onAction={setModal} />}

      <Modal open={modal?.kind === 'expense'} onClose={close} title={modal?.kind === 'expense' && modal.expense ? 'Editar gasto' : 'Nuevo gasto'} wide>
        {modal?.kind === 'expense' && (
          <ExpenseForm
            initial={modal.expense}
            defaultNature={modal.nature}
            onCancel={close}
            onSubmit={async (payload) => {
              await saveExpense.mutateAsync({ id: modal.expense?.id, payload });
              close();
            }}
            onSubmitRecurring={async (payload) => {
              await saveTemplate.mutateAsync({ payload });
              close();
            }}
          />
        )}
      </Modal>
      <Modal
        open={modal?.kind === 'pay'}
        onClose={close}
        title={modal?.kind === 'pay' && modal.expense.status === 'paid' ? 'Confirmar monto real' : 'Registrar pago'}
      >
        {modal?.kind === 'pay' && (
          <PayForm
            expense={modal.expense}
            onCancel={close}
            onSubmit={async (payload) => {
              await pay.mutateAsync({ id: modal.expense.id, payload });
              close();
            }}
          />
        )}
      </Modal>
      <Modal open={modal?.kind === 'reassign'} onClose={close} title="Cambiar dueño del gasto">
        {modal?.kind === 'reassign' && (
          <ReassignForm
            current={modal.expense}
            expenseId={modal.expense.id}
            onCancel={close}
            onSubmit={async (payload) => {
              await reassign.mutateAsync({ id: modal.expense.id, payload });
              close();
            }}
          />
        )}
      </Modal>
      <Modal
        open={modal?.kind === 'recurring'}
        onClose={close}
        title={modal?.kind === 'recurring' && modal.template ? 'Editar gasto fijo' : modal?.kind === 'recurring' && modal.fromExpense ? 'Convertir en gasto fijo' : 'Nuevo gasto fijo'}
        wide
      >
        {modal?.kind === 'recurring' && (
          <RecurringForm
            initial={modal.template}
            fromExpense={modal.fromExpense}
            onCancel={close}
            onSubmit={async (payload) => {
              await saveTemplate.mutateAsync({ id: modal.template?.id, payload });
              close();
            }}
          />
        )}
      </Modal>
      <Modal open={modal?.kind === 'reassign-recurring'} onClose={close} title="Cambiar dueño del gasto fijo">
        {modal?.kind === 'reassign-recurring' && (
          <ReassignForm
            current={modal.template}
            extra={
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Aplicar a</span>
                <Segmented<'future' | 'all'>
                  ariaLabel="Aplicar a"
                  value={applyTo}
                  onChange={setApplyTo}
                  options={[
                    { value: 'future', label: 'Solo de aquí en adelante' },
                    { value: 'all', label: 'También los ya registrados' },
                  ]}
                />
                <p className="text-xs text-muted">Para cambiar un solo mes, usa "Cambiar dueño" sobre ese gasto en Movimientos.</p>
              </div>
            }
            onCancel={close}
            onSubmit={async (payload) => {
              await reassignTemplate.mutateAsync({ id: modal.template.id, payload, apply: applyTo });
              close();
            }}
          />
        )}
      </Modal>
    </>
  );
};
