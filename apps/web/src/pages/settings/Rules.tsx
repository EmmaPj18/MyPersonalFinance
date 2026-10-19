import type { RuleKind } from '@mypersonalfinance/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { CategorySelect, OwnerBadge } from '../../components/finance';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, IconButton, Input, Select, Spinner } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { api } from '../../lib/api';
import { useAccounts, useApiMutation, useCategories, useIncomeSources, useRules } from '../../lib/queries';

const KIND_LABELS: Record<RuleKind, string> = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia', ignore: 'Ignorar' };

/** "When the description contains…" rules used to pre-classify imported transactions. */
export const RulesSettings = () => {
  const { canWrite } = usePrefs();
  const rules = useRules();
  const categories = useCategories();
  const sources = useIncomeSources();
  const accounts = useAccounts();
  const [form, setForm] = useState({ pattern: '', kind: 'expense' as RuleKind, categoryId: null as string | null });
  const create = useApiMutation((payload: unknown) => api.post('/categorization-rules', payload), ['rules', 'inbox']);
  const remove = useApiMutation((id: string) => api.del(`/categorization-rules/${id}`), ['rules']);

  const target = (r: NonNullable<typeof rules.data>[number]) =>
    r.kind === 'expense'
      ? (categories.data?.find((c) => c.id === r.categoryId)?.name ?? 'Sin categoría')
      : r.kind === 'income'
        ? (sources.data?.find((s) => s.id === r.incomeSourceId)?.name ?? '—')
        : r.kind === 'transfer'
          ? (accounts.data?.find((a) => a.id === r.transferAccountId)?.name ?? '—')
          : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({ pattern: form.pattern, kind: form.kind, categoryId: form.kind === 'expense' ? form.categoryId : null });
    setForm({ ...form, pattern: '' });
  };

  return (
    <Card>
      <CardHeader
        title="Reglas para importar"
        subtitle='Si la descripción contiene el texto, la transacción se clasifica sola en "Por revisar". Se crean al registrar con "Recordar".'
      />
      <ErrorBanner error={create.error ?? remove.error} />
      {rules.isLoading ? (
        <Spinner />
      ) : !rules.data?.length ? (
        <EmptyState title="Sin reglas todavía" />
      ) : (
        <ul className="divide-y divide-border">
          {rules.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm sm:px-5">
              <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{r.pattern}</code>
              <span className="text-muted">→</span>
              <Badge>{KIND_LABELS[r.kind]}</Badge>
              <span>{target(r)}</span>
              {r.kind === 'expense' && <OwnerBadge scope={r.scope} ownerUserId={r.ownerUserId} />}
              {canWrite && (
                <IconButton className="ml-auto" label={`Eliminar regla ${r.pattern}`} onClick={() => remove.mutate(r.id)} icon={<Trash2 className="size-4" />} />
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form onSubmit={submit} className="flex flex-wrap gap-2 border-t border-border p-4 sm:px-5">
          <Input aria-label="Texto de la regla" placeholder="Ej. supermercado nacional" required minLength={2} className="min-w-48 flex-1" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} />
          <Select aria-label="Tipo" className="!w-auto" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as RuleKind })}>
            <option value="expense">Gasto</option>
            <option value="ignore">Ignorar</option>
          </Select>
          {form.kind === 'expense' && (
            <div className="w-48">
              <CategorySelect ariaLabel="Categoría de la regla" value={form.categoryId} onChange={(categoryId) => setForm({ ...form, categoryId })} />
            </div>
          )}
          <Button type="submit" icon={<Plus className="size-4" />} loading={create.isPending}>
            Agregar
          </Button>
        </form>
      )}
    </Card>
  );
};
