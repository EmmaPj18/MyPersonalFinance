import { ACCOUNT_TYPES, type AccountType, type Currency } from '@mypersonalfinance/shared';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { CurrencySelect, Money, NullableOwnerSelect, OwnerBadge } from '../../components/finance';
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, MoneyInput, Select, Spinner } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { api } from '../../lib/api';
import { ACCOUNT_TYPE_LABELS } from '../../lib/format';
import { useAccounts, useApiMutation } from '../../lib/queries';
import type { Account } from '../../lib/types';

const AccountForm = ({ initial, onSubmit, onCancel }: { initial?: Account; onSubmit: (p: unknown) => Promise<unknown>; onCancel: () => void }) => {
  const { me } = usePrefs();
  const [f, setF] = useState({
    name: initial?.name ?? '',
    type: (initial?.type ?? 'bank') as AccountType,
    currency: (initial?.currency ?? me.defaultCurrency) as Currency,
    ownerUserId: initial ? initial.ownerUserId : (me.id as string | null),
    openingBalance: initial?.openingBalance ?? '0',
    identifiers: initial?.identifiers ?? '',
    archived: initial?.archived ?? false,
  });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ ...f, identifiers: f.identifiers.trim() || null });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ErrorBanner error={error} />
      <Field label="Nombre">{(id) => <Input id={id} required placeholder="Ej. Banco Popular nómina" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo">
          {(id) => (
            <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AccountType })}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="De quién es">{(id) => <NullableOwnerSelect id={id} value={f.ownerUserId} onChange={(ownerUserId) => setF({ ...f, ownerUserId })} />}</Field>
        <Field label="Moneda">{(id) => <CurrencySelect id={id} value={f.currency} onChange={(currency) => setF({ ...f, currency })} />}</Field>
        <Field label="Saldo inicial">{(id) => <MoneyInput id={id} value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} />}</Field>
        <Field
          label="Terminaciones (opcional)"
          hint="Últimos 4 dígitos de la cuenta y de sus tarjetas, separados por coma (ej. 7610, 4010). Para Wise escribe «wise». Sirve para asociar los correos del banco."
          className="sm:col-span-2"
        >
          {(id) => <Input id={id} placeholder="7610, 4010" value={f.identifiers} onChange={(e) => setF({ ...f, identifiers: e.target.value })} />}
        </Field>
      </div>
      {initial && <Checkbox label="Archivada" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />}
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

export const AccountsSettings = () => {
  const { canWrite } = usePrefs();
  const accounts = useAccounts();
  const [modal, setModal] = useState<Account | 'new' | null>(null);
  const save = useApiMutation(({ id, payload }: { id?: string; payload: unknown }) => (id ? api.put(`/accounts/${id}`, payload) : api.post('/accounts', payload)), ['accounts']);
  const remove = useApiMutation((id: string) => api.del(`/accounts/${id}`), ['accounts']);

  return (
    <Card>
      <CardHeader
        title="Cuentas"
        subtitle="Bancos, efectivo, tarjetas, ahorros e inversiones. El saldo se calcula con ingresos netos y gastos pagados."
        actions={canWrite && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setModal('new')}>Nueva cuenta</Button>}
      />
      {accounts.isLoading ? (
        <Spinner />
      ) : !accounts.data?.length ? (
        <EmptyState title="Sin cuentas" />
      ) : (
        <ul className="divide-y divide-border">
          {accounts.data.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5 ${a.archived ? 'opacity-60' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {a.name} {a.archived && <Badge>Archivada</Badge>}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Badge>{ACCOUNT_TYPE_LABELS[a.type]}</Badge>
                  <OwnerBadge scope={a.ownerUserId ? 'personal' : 'shared'} ownerUserId={a.ownerUserId} />
                  {a.missingRate && <Badge tone="warning">Faltan tasas</Badge>}
                  {a.identifiers && <span>· {a.identifiers}</span>}
                </div>
              </div>
              <Money value={a.balance} currency={a.currency} className="font-semibold" />
              {canWrite && (
                <div className="flex">
                  <IconButton label="Editar" onClick={() => setModal(a)} icon={<Pencil className="size-4" />} />
                  <IconButton label="Eliminar" onClick={() => confirm(`¿Eliminar "${a.name}"? Los movimientos quedan sin cuenta.`) && remove.mutate(a.id)} icon={<Trash2 className="size-4" />} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === 'new' ? 'Nueva cuenta' : 'Editar cuenta'}>
        {modal !== null && (
          <AccountForm
            initial={modal === 'new' ? undefined : modal}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await save.mutateAsync({ id: modal === 'new' ? undefined : modal.id, payload });
              setModal(null);
            }}
          />
        )}
      </Modal>
    </Card>
  );
};
