import { INCOME_SOURCE_TYPES, PAY_FREQUENCIES, type Currency, type IncomeSourceType, type PayFrequency } from '@mypersonalfinance/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AccountSelect, CurrencySelect, OwnerSelect, type Ownership } from '../../components/finance';
import { Button, Checkbox, ErrorBanner, Field, IconButton, Input, MoneyInput, Select } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { PAY_FREQUENCY_LABELS, SOURCE_TYPE_LABELS } from '../../lib/format';
import type { DeductionType, IncomeSource } from '../../lib/types';

export const SourceForm = ({
  initial,
  deductionTypes,
  onSubmit,
  onCancel,
}: {
  initial?: IncomeSource;
  deductionTypes: DeductionType[];
  onSubmit: (payload: unknown) => Promise<unknown>;
  onCancel: () => void;
}) => {
  const { me } = usePrefs();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<IncomeSourceType>(initial?.type ?? 'formal_employment');
  const [owner, setOwner] = useState<Ownership>(
    initial ? { scope: initial.scope, ownerUserId: initial.ownerUserId } : { scope: 'personal', ownerUserId: me.id },
  );
  const [currency, setCurrency] = useState<Currency>(initial?.defaultCurrency ?? me.defaultCurrency);
  const [frequency, setFrequency] = useState<PayFrequency>(initial?.payFrequency ?? 'monthly');
  const [accountId, setAccountId] = useState<string | null>(initial?.accountId ?? null);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [templates, setTemplates] = useState(initial?.deductionTemplates ?? []);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const changeType = (t: IncomeSourceType) => {
    setType(t);
    // Investments and savings are usually shared by the household.
    if (!initial && (t === 'investment' || t === 'savings_interest')) setOwner({ scope: 'shared', ownerUserId: null });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name,
        type,
        scope: owner.scope,
        ownerUserId: owner.ownerUserId,
        defaultCurrency: currency,
        payFrequency: frequency,
        accountId,
        isActive,
        deductionTemplates: templates.filter((t) => t.deductionTypeId && t.defaultAmount !== ''),
      });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ErrorBanner error={error} />
      <Field label="Nombre">{(id) => <Input id={id} required placeholder="Ej. Empresa ABC" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => changeType(e.target.value as IncomeSourceType)}>
              {INCOME_SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SOURCE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="De quién es" hint="Las inversiones y ahorros en común pertenecen al hogar.">
          {(id) => <OwnerSelect id={id} value={owner} onChange={setOwner} />}
        </Field>
        <Field label="Moneda habitual">{(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}</Field>
        <Field label="Frecuencia de pago">
          {(id) => (
            <Select id={id} value={frequency} onChange={(e) => setFrequency(e.target.value as PayFrequency)}>
              {PAY_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {PAY_FREQUENCY_LABELS[f]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Cuenta donde se recibe" className="sm:col-span-2">
          {(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">Descuentos habituales (plantilla)</legend>
        <p className="text-xs text-muted">Se precargan al registrar cada pago y puedes ajustarlos ese día.</p>
        {templates.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select
              aria-label="Tipo de descuento"
              value={t.deductionTypeId}
              onChange={(e) => setTemplates(templates.map((x, j) => (j === i ? { ...x, deductionTypeId: e.target.value } : x)))}
            >
              <option value="">Selecciona…</option>
              {deductionTypes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <div className="w-36 shrink-0">
              <MoneyInput
                aria-label="Monto habitual"
                value={t.defaultAmount}
                onChange={(e) => setTemplates(templates.map((x, j) => (j === i ? { ...x, defaultAmount: e.target.value } : x)))}
              />
            </div>
            <IconButton label="Quitar" onClick={() => setTemplates(templates.filter((_, j) => j !== i))} icon={<Trash2 className="size-4" />} />
          </div>
        ))}
        <div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() => setTemplates([...templates, { deductionTypeId: '', defaultAmount: '' }])}
          >
            Agregar descuento habitual
          </Button>
        </div>
      </fieldset>

      <Checkbox label="Fuente activa" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />

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
