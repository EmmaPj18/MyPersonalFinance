import { ArrowRight, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AccountSelect, Money } from '../../components/finance';
import { Button, Card, CardHeader, EmptyState, ErrorBanner, Field, IconButton, Input, MoneyInput, Spinner } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { api } from '../../lib/api';
import { formatDate, today } from '../../lib/format';
import { useAccounts, useApiMutation, useTransfers } from '../../lib/queries';

/** Money moved between the household's own accounts (doesn't count as spending). */
export const TransfersSettings = () => {
  const { canWrite } = usePrefs();
  const transfers = useTransfers();
  const accounts = useAccounts();
  const [f, setF] = useState({ fromAccountId: null as string | null, toAccountId: null as string | null, date: today(), amount: '', toAmount: '', description: '' });
  const create = useApiMutation((payload: unknown) => api.post('/transfers', payload), ['transfers']);
  const remove = useApiMutation((id: string) => api.del(`/transfers/${id}`), ['transfers']);
  const account = (id: string | null) => accounts.data?.find((a) => a.id === id);
  const from = account(f.fromAccountId);
  const to = account(f.toAccountId);
  const crossCurrency = Boolean(from && to && from.currency !== to.currency);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({ ...f, toAmount: crossCurrency ? f.toAmount : null, description: f.description || null });
    setF({ ...f, amount: '', toAmount: '', description: '' });
  };

  return (
    <Card>
      <CardHeader title="Transferencias entre cuentas" subtitle="Mueven saldo entre tus cuentas sin contar como gasto ni ingreso." />
      {canWrite && (
        <form onSubmit={submit} className="grid gap-3 border-b border-border p-4 sm:grid-cols-3 sm:px-5">
          <ErrorBanner error={create.error} />
          <Field label="Desde">{(id) => <AccountSelect id={id} value={f.fromAccountId} onChange={(fromAccountId) => setF({ ...f, fromAccountId })} />}</Field>
          <Field label="Hacia">{(id) => <AccountSelect id={id} value={f.toAccountId} onChange={(toAccountId) => setF({ ...f, toAccountId })} />}</Field>
          <Field label="Fecha">{(id) => <Input id={id} type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label={`Monto${from ? ` (${from.currency})` : ''}`}>{(id) => <MoneyInput id={id} required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          {crossCurrency && (
            <Field label={`Llegó (${to!.currency})`}>{(id) => <MoneyInput id={id} required value={f.toAmount} onChange={(e) => setF({ ...f, toAmount: e.target.value })} />}</Field>
          )}
          <Field label="Nota (opcional)">{(id) => <Input id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
          <div className="flex items-end">
            <Button type="submit" loading={create.isPending} disabled={!f.fromAccountId || !f.toAccountId || f.fromAccountId === f.toAccountId}>
              Registrar transferencia
            </Button>
          </div>
        </form>
      )}
      {transfers.isLoading ? (
        <Spinner />
      ) : !transfers.data?.length ? (
        <EmptyState title="Sin transferencias" />
      ) : (
        <ul className="divide-y divide-border">
          {transfers.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm sm:px-5">
              <span className="w-24 text-muted">{formatDate(t.date)}</span>
              <span>{account(t.fromAccountId)?.name ?? '—'}</span>
              <ArrowRight className="size-4 text-muted" aria-label="hacia" />
              <span>{account(t.toAccountId)?.name ?? '—'}</span>
              {t.description && <span className="text-muted">· {t.description}</span>}
              <span className="ml-auto flex items-center gap-1">
                <Money value={t.amount} currency={t.currency} className="font-medium" />
                {t.toAmount && (
                  <span className="text-xs text-muted">
                    → <Money value={t.toAmount} currency={account(t.toAccountId)?.currency ?? t.currency} />
                  </span>
                )}
                {canWrite && <IconButton label="Eliminar transferencia" onClick={() => remove.mutate(t.id)} icon={<Trash2 className="size-4" />} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
