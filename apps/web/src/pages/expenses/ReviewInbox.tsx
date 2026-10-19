import type { InboxKind } from '@mypersonalfinance/shared';
import clsx from 'clsx';
import { CheckCheck, EyeOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CategorySelect, Money, OwnerSelect, type Ownership } from '../../components/finance';
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBanner, Notice, Select, Spinner } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { api } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import { useAccounts, useApiMutation, useInbox, useIncomeSources } from '../../lib/queries';
import type { InboxItem } from '../../lib/types';

const KIND_LABELS: Record<InboxKind, string> = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia', refund: 'Devolución', ignore: 'Ignorar' };

interface Draft {
  kind: InboxKind;
  categoryId: string | null;
  incomeSourceId: string | null;
  transferAccountId: string | null;
  refundExpenseId: string | null;
  owner: Ownership;
}

const draftOf = (i: InboxItem): Draft => ({
  kind: i.kind,
  categoryId: i.categoryId,
  incomeSourceId: i.incomeSourceId,
  transferAccountId: i.transferAccountId,
  refundExpenseId: i.refundExpenseId,
  owner: { scope: i.scope, ownerUserId: i.ownerUserId },
});

/** What still blocks importing a row, or null when it's ready. */
const missing = (i: InboxItem, d: Draft) =>
  d.kind === 'income' && !d.incomeSourceId
    ? 'Elige la fuente'
    : d.kind === 'transfer' && (!d.transferAccountId || !i.accountId)
      ? !i.accountId
        ? 'Sin cuenta de origen'
        : 'Elige la cuenta'
      : null;

/** Imported transactions waiting to be classified and registered. */
export const ReviewInbox = () => {
  const { canWrite } = usePrefs();
  const inbox = useInbox();
  const sources = useIncomeSources();
  const accounts = useAccounts();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remember, setRemember] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const commit = useApiMutation(
    (payload: unknown) => api.post<Record<InboxKind, number>>('/inbox/commit', payload),
    ['inbox', 'expenses', 'income-entries', 'transfers', 'rules'],
  );
  const ignore = useApiMutation((ids: string[]) => api.post('/inbox/ignore', { ids }), ['inbox']);

  const items = useMemo(() => inbox.data ?? [], [inbox.data]);
  // Only rows the user edited keep local values; the rest follow the server (e.g. new rules).
  useEffect(() => {
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => items.some((i) => i.id === id))));
    setSelected((prev) => new Set([...prev].filter((id) => items.some((i) => i.id === id))));
  }, [items]);

  if (inbox.isLoading) return <Spinner />;
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState title="Nada por revisar" description='Importa un estado de cuenta o la plantilla con "Importar archivo".' />
      </Card>
    );
  }

  const draft = (i: InboxItem) => drafts[i.id] ?? draftOf(i);
  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts({ ...drafts, [id]: { ...draft(items.find((i) => i.id === id)!), ...patch } });
  const allSelected = selected.size === items.length;
  const chosen = items.filter((i) => selected.has(i.id));
  const blocked = chosen.filter((i) => missing(i, draft(i)));

  const submit = async () => {
    const result = await commit.mutateAsync({
      remember,
      items: chosen.map((i) => {
        const d = draft(i);
        return {
          id: i.id,
          kind: d.kind,
          categoryId: d.categoryId,
          incomeSourceId: d.incomeSourceId,
          transferAccountId: d.transferAccountId,
          refundExpenseId: d.kind === 'refund' ? d.refundExpenseId : null,
          scope: d.owner.scope,
          ownerUserId: d.owner.ownerUserId,
        };
      }),
    });
    setSelected(new Set());
    setNotice(
      `Registrados: ${result.expense} gastos, ${result.income} ingresos, ${result.transfer} transferencias${result.refund ? `, ${result.refund} devoluciones` : ''}${result.ignore ? `; ${result.ignore} ignorados` : ''}.`,
    );
  };

  return (
    <Card>
      <CardHeader
        title={`Por revisar (${items.length})`}
        subtitle="Elige qué es cada movimiento. Las reglas recordadas se aplican solas a los próximos."
        actions={
          canWrite && (
            <>
              <Checkbox label="Recordar para próximos" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <Button variant="secondary" size="sm" icon={<EyeOff className="size-4" />} disabled={!chosen.length} onClick={() => ignore.mutate(chosen.map((i) => i.id))}>
                Ignorar
              </Button>
              <Button size="sm" icon={<CheckCheck className="size-4" />} disabled={!chosen.length || blocked.length > 0} loading={commit.isPending} onClick={submit}>
                Registrar {chosen.length || ''}
              </Button>
            </>
          )
        }
      />
      <div className="flex flex-col gap-2 px-4 pt-3 sm:px-5">
        <ErrorBanner error={commit.error ?? ignore.error} />
        {notice && <Notice tone="primary">{notice}</Notice>}
        {blocked.length > 0 && <Notice>Completa {blocked.length} fila(s) seleccionadas antes de registrar.</Notice>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="border-b border-border px-4 py-2">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todo"
                  className="size-4 accent-[var(--primary)]"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}
                />
              </th>
              <th className="border-b border-border px-2 py-2">Fecha</th>
              <th className="border-b border-border px-2 py-2">Descripción</th>
              <th className="border-b border-border px-2 py-2 text-right">Monto</th>
              <th className="border-b border-border px-2 py-2">Es</th>
              <th className="border-b border-border px-2 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const d = draft(i);
              const problem = missing(i, d);
              return (
                <tr key={i.id} className={clsx('border-b border-border', d.kind === 'ignore' && 'opacity-60')}>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${i.description}`}
                      className="size-4 accent-[var(--primary)]"
                      checked={selected.has(i.id)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(i.id)) next.delete(i.id);
                        else next.add(i.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">{formatDate(i.date)}</td>
                  <td className="px-2 py-2">
                    <span className="font-medium">{i.description}</span>{' '}
                    <span className="inline-flex flex-wrap gap-1 align-middle">
                      {i.duplicateOfExpenseId && <Badge tone="warning">Posible duplicado</Badge>}
                      {i.ruleId && <Badge tone="primary">Regla</Badge>}
                      {i.source === 'email' && <Badge>Correo</Badge>}
                    </span>
                    <p className="text-xs text-muted">{accounts.data?.find((a) => a.id === i.accountId)?.name ?? 'Sin cuenta'}</p>
                  </td>
                  <td className={clsx('whitespace-nowrap px-2 py-2 text-right font-medium', i.direction === 'credit' && 'text-success')}>
                    {i.direction === 'credit' ? '+' : '−'}
                    <Money value={i.amount} currency={i.currency} />
                  </td>
                  <td className="px-2 py-2">
                    <Select
                      aria-label={`Tipo de ${i.description}`}
                      className="!h-8 !w-36 text-xs"
                      value={d.kind}
                      onChange={(e) => update(i.id, { kind: e.target.value as InboxKind })}
                    >
                      {(Object.keys(KIND_LABELS) as InboxKind[]).filter((k) => k !== 'refund' || i.direction === 'credit').map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {d.kind === 'expense' && (
                        <>
                          <div className="w-44">
                            <CategorySelect ariaLabel={`Categoría de ${i.description}`} value={d.categoryId} onChange={(categoryId) => update(i.id, { categoryId })} />
                          </div>
                          <div className="w-44">
                            <OwnerSelect ariaLabel={`De quién es ${i.description}`} value={d.owner} onChange={(owner) => update(i.id, { owner })} />
                          </div>
                        </>
                      )}
                      {d.kind === 'income' && (
                        <Select
                          aria-label={`Fuente de ${i.description}`}
                          className="!w-56"
                          value={d.incomeSourceId ?? ''}
                          onChange={(e) => update(i.id, { incomeSourceId: e.target.value || null })}
                        >
                          <option value="">Fuente de ingreso…</option>
                          {(sources.data ?? []).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </Select>
                      )}
                      {d.kind === 'transfer' && (
                        <Select
                          aria-label={`Cuenta de la transferencia ${i.description}`}
                          className="!w-56"
                          value={d.transferAccountId ?? ''}
                          onChange={(e) => update(i.id, { transferAccountId: e.target.value || null })}
                        >
                          <option value="">{i.direction === 'debit' ? 'Hacia la cuenta…' : 'Desde la cuenta…'}</option>
                          {(accounts.data ?? [])
                            .filter((a) => a.id !== i.accountId)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </Select>
                      )}
                      {d.kind === 'refund' &&
                        (i.refundCandidates?.length ? (
                          <Select
                            aria-label={`Compra de la devolución ${i.description}`}
                            className="!w-72"
                            value={d.refundExpenseId ?? ''}
                            onChange={(e) => update(i.id, { refundExpenseId: e.target.value || null })}
                          >
                            <option value="">La compra más reciente del comercio</option>
                            {i.refundCandidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {formatDate(c.date)} · {c.description} · {formatMoney(c.amount, i.currency)}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-xs text-muted">Se resta de la compra del mismo comercio (regístrala antes o junto con esta).</span>
                        ))}
                      {problem && <span className="text-xs text-warning">{problem}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
