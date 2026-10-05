import type { ExpenseNature, Scope } from '@mypersonalfinance/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, Plus, Trash2, UserRoundCog } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { formatDate, formatMoney, formatMonth, RECURRENCE_LABELS } from '../lib/format';
import { useApiMutation, useCategories, useExpenses, useRecurringExpenses } from '../lib/queries';
import type { Expense, RecurringExpense } from '../lib/types';
import { ExpenseForm, PayForm, ReassignForm, RecurringForm } from './expenses/forms';

type Tab = 'variable' | 'fixed' | 'templates';
type ScopeFilter = 'all' | Scope;

type ModalState =
  | { kind: 'expense'; expense?: Expense; nature?: ExpenseNature }
  | { kind: 'pay'; expense: Expense }
  | { kind: 'reassign'; expense: Expense }
  | { kind: 'recurring'; template?: RecurringExpense }
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
              {e.status === 'pending' && <Badge tone="warning">Pendiente</Badge>}
              {e.nature === 'fixed' && <Badge>Fijo</Badge>}
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
                  {e.status === 'pending' && (
                    <IconButton label="Marcar como pagado" onClick={() => onAction({ kind: 'pay', expense: e })} icon={<CheckCircle2 className="size-4" />} />
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

export const ExpensesPage = () => {
  const { month, view, me, members, canWrite, isOwner } = usePrefs();
  const [tab, setTab] = useState<Tab>('variable');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [person, setPerson] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const categories = useCategories();
  const templates = useRecurringExpenses();
  const qc = useQueryClient();

  const expenses = useExpenses({
    month,
    nature: tab === 'templates' ? undefined : tab,
    scope: scope === 'all' ? undefined : scope,
    ownerUserId: person || undefined,
    categoryId: categoryId || undefined,
  });

  // Fixed expenses of the month are generated automatically (idempotent) when the tab opens.
  useEffect(() => {
    if (tab !== 'fixed' || !canWrite) return;
    void api.post<{ created: number }>('/recurring-expenses/generate', {}, { month }).then((r) => {
      if (r.created > 0) void qc.invalidateQueries({ queryKey: ['expenses'] });
    });
  }, [tab, month, canWrite, qc]);

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
  const removeTemplate = useApiMutation((id: string) => api.del(`/recurring-expenses/${id}`), ['recurring-expenses', 'expenses']);
  const reassignTemplate = useApiMutation(
    ({ id, payload, apply }: { id: string; payload: unknown; apply: string }) =>
      api.post(`/recurring-expenses/${id}/reassign`, payload, { apply }),
    ['recurring-expenses', 'expenses'],
  );
  const [applyTo, setApplyTo] = useState<'future' | 'all'>('future');

  // "Mis finanzas": my personal expenses + the shared ones.
  const rows = (expenses.data ?? []).filter((e) => view === 'household' || e.scope === 'shared' || e.ownerUserId === me.id);
  const pending = rows.filter((e) => e.status === 'pending');

  return (
    <>
      <PageHeader
        title="Gastos"
        subtitle="Gastos corrientes y fijos, del hogar o personales."
        actions={
          <>
            <MonthPicker />
            {canWrite && tab !== 'templates' && (
              <Button icon={<Plus className="size-4" />} onClick={() => setModal({ kind: 'expense', nature: tab === 'fixed' ? 'fixed' : 'variable' })}>
                Nuevo gasto
              </Button>
            )}
            {canWrite && tab === 'templates' && (
              <Button icon={<Plus className="size-4" />} onClick={() => setModal({ kind: 'recurring' })}>
                Nuevo gasto fijo
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<Tab>
          ariaLabel="Tipo de gastos"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'variable', label: 'Corrientes' },
            { value: 'fixed', label: 'Fijos del mes' },
            { value: 'templates', label: 'Gastos fijos (plantillas)' },
          ]}
        />
        {tab !== 'templates' && (
          <div className="flex flex-wrap items-center gap-2">
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

      {tab !== 'templates' && (
        <Card>
          <CardHeader
            title={`${tab === 'fixed' ? 'Gastos fijos' : 'Gastos corrientes'} de ${formatMonth(month)}`}
            subtitle={
              tab === 'fixed' && rows.length > 0
                ? `${rows.length - pending.length} de ${rows.length} pagados`
                : undefined
            }
          />
          {expenses.isLoading ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Sin gastos"
              description={
                tab === 'fixed'
                  ? 'Crea tus gastos fijos (alquiler, servicios, colegio…) en la pestaña de plantillas y aparecerán aquí cada mes.'
                  : 'Registra tus gastos del día a día.'
              }
            />
          ) : (
            <ExpenseTable expenses={rows} onAction={setModal} />
          )}
        </Card>
      )}

      {tab === 'templates' && (
        <Card>
          <CardHeader title="Gastos fijos" subtitle="Se generan automáticamente como pendientes cada mes." />
          {templates.isLoading ? (
            <Spinner />
          ) : !templates.data?.length ? (
            <EmptyState title="Sin gastos fijos" description="Ej. alquiler, internet, colegio, seguros, suscripciones." />
          ) : (
            <ul className="divide-y divide-border">
              {templates.data.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {t.name} {!t.active && <Badge>Inactivo</Badge>} {t.isVariableAmount && <Badge tone="warning">Monto variable</Badge>}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <OwnerBadge scope={t.scope} ownerUserId={t.ownerUserId} />
                      <span>
                        {RECURRENCE_LABELS[t.frequency]} · día {t.dueDay} · {t.categoryName ?? 'Sin categoría'}
                      </span>
                    </div>
                  </div>
                  <Money value={t.amount} currency={t.currency} className="font-medium" />
                  {canWrite && (isOwner || t.scope === 'shared' || t.ownerUserId === me.id) && (
                    <div className="flex items-center gap-1">
                      <IconButton label="Cambiar dueño" onClick={() => setModal({ kind: 'reassign-recurring', template: t })} icon={<UserRoundCog className="size-4" />} />
                      <IconButton label="Editar" onClick={() => setModal({ kind: 'recurring', template: t })} icon={<Pencil className="size-4" />} />
                      <IconButton
                        label="Eliminar"
                        onClick={() => confirm(`¿Eliminar "${t.name}"? Se borran sus pendientes; los pagados se conservan.`) && removeTemplate.mutate(t.id)}
                        icon={<Trash2 className="size-4" />}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

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
          />
        )}
      </Modal>
      <Modal open={modal?.kind === 'pay'} onClose={close} title="Registrar pago">
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
      <Modal open={modal?.kind === 'recurring'} onClose={close} title={modal?.kind === 'recurring' && modal.template ? 'Editar gasto fijo' : 'Nuevo gasto fijo'} wide>
        {modal?.kind === 'recurring' && (
          <RecurringForm
            initial={modal.template}
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
                    { value: 'future', label: 'Este y los próximos pendientes' },
                    { value: 'all', label: 'Todos (incluye pagados)' },
                  ]}
                />
                <p className="text-xs text-muted">Para cambiar solo un mes, usa "Cambiar dueño" sobre ese gasto en "Fijos del mes".</p>
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
