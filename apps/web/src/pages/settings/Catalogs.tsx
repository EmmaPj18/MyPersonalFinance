import { DEDUCTION_CATEGORIES, EXPENSE_NATURES, type DeductionCategory, type ExpenseNature } from '@mypersonalfinance/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, CardHeader, ErrorBanner, IconButton, Input, Select, Spinner } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { api } from '../../lib/api';
import { DEDUCTION_CATEGORY_LABELS } from '../../lib/format';
import { useApiMutation, useCategories, useDeductionTypes } from '../../lib/queries';

const NATURE_LABELS: Record<ExpenseNature, string> = { fixed: 'Fijo', variable: 'Corriente' };

export const CatalogSettings = () => {
  const { canWrite } = usePrefs();
  const categories = useCategories();
  const deductionTypes = useDeductionTypes();
  const [cat, setCat] = useState({ name: '', defaultNature: 'variable' as ExpenseNature, color: '#6366f1' });
  const [ded, setDed] = useState({ name: '', category: 'other' as DeductionCategory });

  const saveCategory = useApiMutation(({ id, payload }: { id?: string; payload: unknown }) => (id ? api.put(`/categories/${id}`, payload) : api.post('/categories', payload)), ['categories']);
  const removeCategory = useApiMutation((id: string) => api.del(`/categories/${id}`), ['categories', 'expenses']);
  const saveDeduction = useApiMutation(({ id, payload }: { id?: string; payload: unknown }) => (id ? api.put(`/deduction-types/${id}`, payload) : api.post('/deduction-types', payload)), ['deduction-types']);
  const removeDeduction = useApiMutation((id: string) => api.del(`/deduction-types/${id}`), ['deduction-types']);

  const addCategory = async (e: FormEvent) => {
    e.preventDefault();
    await saveCategory.mutateAsync({ payload: cat });
    setCat({ ...cat, name: '' });
  };
  const addDeduction = async (e: FormEvent) => {
    e.preventDefault();
    await saveDeduction.mutateAsync({ payload: ded });
    setDed({ ...ded, name: '' });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Categorías de gasto" subtitle="El tipo (fijo/corriente) se sugiere al registrar un gasto." />
        <ErrorBanner error={saveCategory.error ?? removeCategory.error} />
        {categories.isLoading ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-border">
            {(categories.data ?? []).map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-4 py-2 sm:px-5">
                <input
                  type="color"
                  aria-label={`Color de ${c.name}`}
                  className="size-6 cursor-pointer rounded border-0 bg-transparent"
                  defaultValue={c.color ?? '#94a3b8'}
                  disabled={!canWrite}
                  onBlur={(e) => e.target.value !== c.color && saveCategory.mutate({ id: c.id, payload: { ...c, color: e.target.value } })}
                />
                <span className="flex-1 text-sm">{c.name}</span>
                {canWrite ? (
                  <Select
                    aria-label={`Tipo de ${c.name}`}
                    className="!h-8 !w-auto text-xs"
                    value={c.defaultNature}
                    onChange={(e) => saveCategory.mutate({ id: c.id, payload: { ...c, defaultNature: e.target.value } })}
                  >
                    {EXPENSE_NATURES.map((n) => (
                      <option key={n} value={n}>
                        {NATURE_LABELS[n]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge>{NATURE_LABELS[c.defaultNature]}</Badge>
                )}
                {canWrite && (
                  <IconButton
                    label="Eliminar categoría"
                    onClick={() => confirm(`¿Eliminar "${c.name}"? Los gastos quedarán sin categoría.`) && removeCategory.mutate(c.id)}
                    icon={<Trash2 className="size-4" />}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <form onSubmit={addCategory} className="flex flex-wrap gap-2 border-t border-border p-4 sm:px-5">
            <Input aria-label="Nueva categoría" placeholder="Nueva categoría" required className="flex-1" value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} />
            <Select aria-label="Tipo" className="!w-auto" value={cat.defaultNature} onChange={(e) => setCat({ ...cat, defaultNature: e.target.value as ExpenseNature })}>
              {EXPENSE_NATURES.map((n) => (
                <option key={n} value={n}>
                  {NATURE_LABELS[n]}
                </option>
              ))}
            </Select>
            <Button type="submit" icon={<Plus className="size-4" />} loading={saveCategory.isPending}>
              Agregar
            </Button>
          </form>
        )}
      </Card>

      <Card>
        <CardHeader title="Tipos de descuento" subtitle="Impuestos, seguridad social y otros descuentos de nómina." />
        <ErrorBanner error={saveDeduction.error ?? removeDeduction.error} />
        {deductionTypes.isLoading ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-border">
            {(deductionTypes.data ?? []).map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-4 py-2 sm:px-5">
                <span className="flex-1 text-sm">{d.name}</span>
                <Badge>{DEDUCTION_CATEGORY_LABELS[d.category]}</Badge>
                {canWrite && (
                  <IconButton
                    label="Eliminar tipo de descuento"
                    onClick={() => confirm(`¿Eliminar "${d.name}"?`) && removeDeduction.mutate(d.id)}
                    icon={<Trash2 className="size-4" />}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <form onSubmit={addDeduction} className="flex flex-wrap gap-2 border-t border-border p-4 sm:px-5">
            <Input aria-label="Nuevo tipo de descuento" placeholder="Nuevo descuento" required className="flex-1" value={ded.name} onChange={(e) => setDed({ ...ded, name: e.target.value })} />
            <Select aria-label="Categoría" className="!w-auto" value={ded.category} onChange={(e) => setDed({ ...ded, category: e.target.value as DeductionCategory })}>
              {DEDUCTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {DEDUCTION_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
            <Button type="submit" icon={<Plus className="size-4" />} loading={saveDeduction.isPending}>
              Agregar
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
};
