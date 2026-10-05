import { DEBT_TYPES, type Currency, type DebtType } from '@mypersonalfinance/shared';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AccountSelect, CurrencySelect, Money, NullableOwnerSelect, OwnerBadge } from '../components/finance';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, MoneyInput, PageHeader, ProgressBar, Select, Spinner } from '../components/ui';
import { usePrefs } from '../context/prefs';
import { api } from '../lib/api';
import { DEBT_TYPE_LABELS, formatDate, formatPct, today } from '../lib/format';
import { useApiMutation, useDebts } from '../lib/queries';
import type { Debt } from '../lib/types';

const useSubmit = (onSubmit: (p: unknown) => Promise<unknown>) => {
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  return {
    error,
    saving,
    run: async (payload: unknown) => {
      setSaving(true);
      try {
        await onSubmit(payload);
      } catch (err) {
        setError(err);
        setSaving(false);
      }
    },
  };
};

const DebtForm = ({ initial, onSubmit, onCancel }: { initial?: Debt; onSubmit: (p: unknown) => Promise<unknown>; onCancel: () => void }) => {
  const { me } = usePrefs();
  const [f, setF] = useState({
    name: initial?.name ?? '',
    type: (initial?.type ?? 'loan') as DebtType,
    originalAmount: initial?.originalAmount ?? '',
    currency: (initial?.currency ?? me.defaultCurrency) as Currency,
    interestRate: initial?.interestRate ?? '',
    minPayment: initial?.minPayment ?? '',
    dueDay: initial?.dueDay ? String(initial.dueDay) : '',
    startDate: initial?.startDate ?? today(),
    ownerUserId: initial ? initial.ownerUserId : (me.id as string | null),
    archived: initial?.archived ?? false,
  });
  const { error, saving, run } = useSubmit(onSubmit);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({
      ...f,
      interestRate: f.interestRate === '' ? null : Number(f.interestRate),
      minPayment: f.minPayment || null,
      dueDay: f.dueDay ? Number(f.dueDay) : null,
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ErrorBanner error={error} />
      <Field label="Nombre">{(id) => <Input id={id} required placeholder="Ej. Préstamo vehículo" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo">
          {(id) => (
            <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as DebtType })}>
              {DEBT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DEBT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="De quién es">{(id) => <NullableOwnerSelect id={id} value={f.ownerUserId} onChange={(ownerUserId) => setF({ ...f, ownerUserId })} />}</Field>
      </div>
      <div className="grid grid-cols-[1fr_7rem] gap-4">
        <Field label="Monto original / saldo inicial">{(id) => <MoneyInput id={id} required value={f.originalAmount} onChange={(e) => setF({ ...f, originalAmount: e.target.value })} />}</Field>
        <Field label="Moneda">{(id) => <CurrencySelect id={id} value={f.currency} onChange={(currency) => setF({ ...f, currency })} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tasa anual % (opcional)">
          {(id) => <Input id={id} type="number" step="0.01" min="0" value={f.interestRate} onChange={(e) => setF({ ...f, interestRate: e.target.value })} />}
        </Field>
        <Field label="Cuota mínima (opcional)">{(id) => <MoneyInput id={id} value={f.minPayment} onChange={(e) => setF({ ...f, minPayment: e.target.value })} />}</Field>
        <Field label="Día de pago (opcional)">
          {(id) => <Input id={id} type="number" min={1} max={31} value={f.dueDay} onChange={(e) => setF({ ...f, dueDay: e.target.value })} />}
        </Field>
        <Field label="Fecha de inicio">{(id) => <Input id={id} type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />}</Field>
      </div>
      {initial && <Checkbox label="Archivada (saldada)" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving}>
          Guardar
        </Button>
      </div>
    </form>
  );
};

const PaymentForm = ({ debt, onSubmit, onCancel }: { debt: Debt; onSubmit: (p: unknown) => Promise<unknown>; onCancel: () => void }) => {
  const [f, setF] = useState({ date: today(), amount: debt.minPayment ?? '', interestPortion: '0', createExpense: true, accountId: null as string | null });
  const { error, saving, run } = useSubmit(onSubmit);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(f);
      }}
      className="flex flex-col gap-4"
    >
      <ErrorBanner error={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Pago total (${debt.currency})`}>{(id) => <MoneyInput id={id} required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        <Field label="Parte de intereses" hint="El resto abona a capital.">
          {(id) => <MoneyInput id={id} value={f.interestPortion} onChange={(e) => setF({ ...f, interestPortion: e.target.value })} />}
        </Field>
        <Field label="Fecha">{(id) => <Input id={id} type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Cuenta">{(id) => <AccountSelect id={id} value={f.accountId} onChange={(accountId) => setF({ ...f, accountId })} />}</Field>
      </div>
      <Checkbox label="Registrar también como gasto fijo del mes" checked={f.createExpense} onChange={(e) => setF({ ...f, createExpense: e.target.checked })} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving}>
          Registrar pago
        </Button>
      </div>
    </form>
  );
};

export const DebtsPage = () => {
  const { canWrite, view, me } = usePrefs();
  const debts = useDebts();
  const [modal, setModal] = useState<{ kind: 'debt'; debt?: Debt } | { kind: 'payment'; debt: Debt } | null>(null);
  const save = useApiMutation(({ id, payload }: { id?: string; payload: unknown }) => (id ? api.put(`/debts/${id}`, payload) : api.post('/debts', payload)), ['debts']);
  const remove = useApiMutation((id: string) => api.del(`/debts/${id}`), ['debts', 'expenses']);
  const pay = useApiMutation(({ id, payload }: { id: string; payload: unknown }) => api.post(`/debts/${id}/payments`, payload), ['debts', 'expenses']);
  const removePayment = useApiMutation(({ debtId, id }: { debtId: string; id: string }) => api.del(`/debts/${debtId}/payments/${id}`), ['debts', 'expenses']);
  const close = () => setModal(null);
  const list = (debts.data ?? []).filter((d) => view === 'household' || !d.ownerUserId || d.ownerUserId === me.id);

  return (
    <>
      <PageHeader
        title="Deudas"
        subtitle="Préstamos, tarjetas e hipotecas, personales o del hogar."
        actions={canWrite && <Button icon={<Plus className="size-4" />} onClick={() => setModal({ kind: 'debt' })}>Nueva deuda</Button>}
      />
      {debts.isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState title="Sin deudas registradas" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((d) => (
            <Card key={d.id} className={`p-4 ${d.archived ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {d.name} {d.archived && <Badge tone="success">Saldada</Badge>}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Badge>{DEBT_TYPE_LABELS[d.type]}</Badge>
                    <OwnerBadge scope={d.ownerUserId ? 'personal' : 'shared'} ownerUserId={d.ownerUserId} />
                    {d.interestRate && <span>{formatPct(d.interestRate)} anual</span>}
                    {d.dueDay && <span>· paga el día {d.dueDay}</span>}
                  </div>
                </div>
                {canWrite && (
                  <div className="flex">
                    <IconButton label="Editar" onClick={() => setModal({ kind: 'debt', debt: d })} icon={<Pencil className="size-4" />} />
                    <IconButton label="Eliminar" onClick={() => confirm(`¿Eliminar "${d.name}"?`) && remove.mutate(d.id)} icon={<Trash2 className="size-4" />} />
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-end justify-between gap-2">
                <div>
                  <p className="text-xs text-muted">Saldo pendiente</p>
                  <p className="text-2xl font-semibold text-danger">
                    <Money value={d.balance} currency={d.currency} />
                  </p>
                </div>
                <p className="text-right text-xs text-muted">
                  Capital pagado <Money value={d.principalPaid} currency={d.currency} />
                  <br />
                  Intereses pagados <Money value={d.interestPaid} currency={d.currency} />
                </p>
              </div>
              <div className="mt-2">
                <ProgressBar value={Number(d.progressPct)} tone="success" />
              </div>
              {canWrite && !d.archived && (
                <div className="mt-3 flex justify-end">
                  <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'payment', debt: d })}>
                    Registrar pago
                  </Button>
                </div>
              )}
              {d.payments.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted">Pagos ({d.payments.length})</summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {d.payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <span className="text-muted">{formatDate(p.date)}</span>
                        <span className="flex items-center gap-1">
                          <Money value={p.amount} currency={d.currency} />
                          {canWrite && (
                            <IconButton label="Eliminar pago" onClick={() => removePayment.mutate({ debtId: d.id, id: p.id })} icon={<Trash2 className="size-3.5" />} />
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
      <Modal open={modal?.kind === 'debt'} onClose={close} title={modal?.kind === 'debt' && modal.debt ? 'Editar deuda' : 'Nueva deuda'}>
        {modal?.kind === 'debt' && (
          <DebtForm
            initial={modal.debt}
            onCancel={close}
            onSubmit={async (payload) => {
              await save.mutateAsync({ id: modal.debt?.id, payload });
              close();
            }}
          />
        )}
      </Modal>
      <Modal open={modal?.kind === 'payment'} onClose={close} title={`Pago · ${modal?.kind === 'payment' ? modal.debt.name : ''}`}>
        {modal?.kind === 'payment' && (
          <PaymentForm
            debt={modal.debt}
            onCancel={close}
            onSubmit={async (payload) => {
              await pay.mutateAsync({ id: modal.debt.id, payload });
              close();
            }}
          />
        )}
      </Modal>
    </>
  );
};
