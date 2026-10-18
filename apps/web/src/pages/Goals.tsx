import type { Currency } from '@mypersonalfinance/shared';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AccountSelect, CurrencySelect, Money, NullableOwnerSelect, OwnerBadge } from '../components/finance';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, MoneyInput, PageHeader, ProgressBar, Segmented, Spinner } from '../components/ui';
import { usePrefs } from '../context/prefs';
import { api } from '../lib/api';
import { formatDate, today } from '../lib/format';
import { useApiMutation, useGoals } from '../lib/queries';
import type { Goal } from '../lib/types';

const GoalForm = ({ initial, onSubmit, onCancel }: { initial?: Goal; onSubmit: (p: unknown) => Promise<unknown>; onCancel: () => void }) => {
  const { me } = usePrefs();
  const [name, setName] = useState(initial?.name ?? '');
  const [target, setTarget] = useState(initial?.targetAmount ?? '');
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? me.defaultCurrency);
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? '');
  const [owner, setOwner] = useState<string | null>(initial ? initial.ownerUserId : null);
  const [accountId, setAccountId] = useState<string | null>(initial?.accountId ?? null);
  const [archived, setArchived] = useState(initial?.archived ?? false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ name, targetAmount: target, currency, targetDate: targetDate || null, ownerUserId: owner, accountId, archived });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ErrorBanner error={error} />
      <Field label="Nombre">{(id) => <Input id={id} required placeholder="Ej. Fondo de emergencia" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="grid grid-cols-[1fr_7rem] gap-4">
        <Field label="Meta">{(id) => <MoneyInput id={id} required value={target} onChange={(e) => setTarget(e.target.value)} />}</Field>
        <Field label="Moneda">{(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fecha objetivo (opcional)">{(id) => <Input id={id} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />}</Field>
        <Field label="De quién es">{(id) => <NullableOwnerSelect id={id} value={owner} onChange={setOwner} />}</Field>
        <Field label="Cuenta asociada" className="sm:col-span-2">
          {(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}
        </Field>
      </div>
      {initial && <Checkbox label="Archivada" checked={archived} onChange={(e) => setArchived(e.target.checked)} />}
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

const ContributionForm = ({ goal, onSubmit, onCancel }: { goal: Goal; onSubmit: (p: unknown) => Promise<unknown>; onCancel: () => void }) => {
  const [type, setType] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await onSubmit({ amount: type === 'in' ? amount : `-${amount}`, date });
        } catch (err) {
          setError(err);
          setSaving(false);
        }
      }}
      className="flex flex-col gap-4"
    >
      <ErrorBanner error={error} />
      <Segmented<'in' | 'out'>
        ariaLabel="Tipo de movimiento"
        value={type}
        onChange={setType}
        options={[
          { value: 'in', label: 'Aporte' },
          { value: 'out', label: 'Retiro' },
        ]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Monto (${goal.currency})`}>{(id) => <MoneyInput id={id} required value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Fecha">{(id) => <Input id={id} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
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

export const GoalsPage = () => {
  const { canWrite, view, isMine } = usePrefs();
  const goals = useGoals();
  const [modal, setModal] = useState<{ kind: 'goal'; goal?: Goal } | { kind: 'contribution'; goal: Goal } | null>(null);
  const save = useApiMutation(({ id, payload }: { id?: string; payload: unknown }) => (id ? api.put(`/goals/${id}`, payload) : api.post('/goals', payload)), ['goals']);
  const remove = useApiMutation((id: string) => api.del(`/goals/${id}`), ['goals']);
  const contribute = useApiMutation(({ id, payload }: { id: string; payload: unknown }) => api.post(`/goals/${id}/contributions`, payload), ['goals']);
  const removeContribution = useApiMutation(({ goalId, id }: { goalId: string; id: string }) => api.del(`/goals/${goalId}/contributions/${id}`), ['goals']);
  const close = () => setModal(null);
  const list = (goals.data ?? []).filter((g) => view === 'household' || !g.ownerUserId || isMine(g.ownerUserId));

  return (
    <>
      <PageHeader
        title="Metas de ahorro"
        subtitle="Ahorros personales o en común del hogar."
        actions={canWrite && <Button icon={<Plus className="size-4" />} onClick={() => setModal({ kind: 'goal' })}>Nueva meta</Button>}
      />
      {goals.isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState title="Sin metas" description="Ej. fondo de emergencia, vacaciones, inicial de una casa." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((g) => (
            <Card key={g.id} className={`p-4 ${g.archived ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {g.name} {g.archived && <Badge>Archivada</Badge>}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <OwnerBadge scope={g.ownerUserId ? 'personal' : 'shared'} ownerUserId={g.ownerUserId} />
                    {g.targetDate && <span>Para el {formatDate(g.targetDate)}</span>}
                  </div>
                </div>
                {canWrite && (
                  <div className="flex">
                    <IconButton label="Editar" onClick={() => setModal({ kind: 'goal', goal: g })} icon={<Pencil className="size-4" />} />
                    <IconButton label="Eliminar" onClick={() => confirm(`¿Eliminar "${g.name}"?`) && remove.mutate(g.id)} icon={<Trash2 className="size-4" />} />
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-end justify-between gap-2">
                <p className="text-2xl font-semibold">
                  <Money value={g.saved} currency={g.currency} />
                </p>
                <p className="text-sm text-muted">
                  de <Money value={g.targetAmount} currency={g.currency} />
                </p>
              </div>
              <div className="mt-2">
                <ProgressBar value={Number(g.progressPct)} tone="success" />
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-muted">
                  Faltan <Money value={g.remaining} currency={g.currency} />
                </span>
                {canWrite && (
                  <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'contribution', goal: g })}>
                    Aporte / retiro
                  </Button>
                )}
              </div>
              {g.contributions.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted">Movimientos ({g.contributions.length})</summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {g.contributions.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2">
                        <span className="text-muted">{formatDate(c.date)}</span>
                        <span className="flex items-center gap-1">
                          <Money value={c.amount} currency={g.currency} className={Number(c.amount) < 0 ? 'text-danger' : ''} />
                          {canWrite && (
                            <IconButton label="Eliminar movimiento" onClick={() => removeContribution.mutate({ goalId: g.id, id: c.id })} icon={<Trash2 className="size-3.5" />} />
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
      <Modal open={modal?.kind === 'goal'} onClose={close} title={modal?.kind === 'goal' && modal.goal ? 'Editar meta' : 'Nueva meta'}>
        {modal?.kind === 'goal' && (
          <GoalForm
            initial={modal.goal}
            onCancel={close}
            onSubmit={async (payload) => {
              await save.mutateAsync({ id: modal.goal?.id, payload });
              close();
            }}
          />
        )}
      </Modal>
      <Modal open={modal?.kind === 'contribution'} onClose={close} title="Aporte o retiro">
        {modal?.kind === 'contribution' && (
          <ContributionForm
            goal={modal.goal}
            onCancel={close}
            onSubmit={async (payload) => {
              await contribute.mutateAsync({ id: modal.goal.id, payload });
              close();
            }}
          />
        )}
      </Modal>
    </>
  );
};
