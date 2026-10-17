import {
  INCOME_SOURCE_TYPES,
  occurrencesBetween,
  PAY_FREQUENCIES,
  WEEKEND_RULES,
  type Currency,
  type IncomeSourceType,
  type PayFrequency,
  type WeekendRule,
} from '@mypersonalfinance/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AccountSelect, CurrencySelect, OwnerSelect, type Ownership } from '../../components/finance';
import { Button, Checkbox, ErrorBanner, Field, IconButton, Input, MoneyInput, Notice, Select } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { formatShortDate, PAY_FREQUENCY_LABELS, SOURCE_TYPE_LABELS, today, WEEKEND_RULE_LABELS } from '../../lib/format';
import type { DeductionType, IncomeSource } from '../../lib/types';

const usesDays = (f: PayFrequency) => f === 'monthly' || f === 'semimonthly' || f === 'quarterly' || f === 'yearly';

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
  const [payDay, setPayDay] = useState(String(initial?.payDay ?? 30));
  const [secondPayDay, setSecondPayDay] = useState(String(initial?.secondPayDay ?? 30));
  const [startDate, setStartDate] = useState(initial?.scheduleStartDate ?? today());
  const [weekendRule, setWeekendRule] = useState<WeekendRule>(initial?.weekendRule ?? 'none');
  const [expectedGross, setExpectedGross] = useState(initial?.expectedGross ?? '');
  const [autoRegister, setAutoRegister] = useState(initial?.autoRegister ?? false);
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

  const changeFrequency = (f: PayFrequency) => {
    setFrequency(f);
    if (f === 'semimonthly' && !initial?.secondPayDay) {
      setPayDay('15');
      setSecondPayDay('30');
    }
  };

  const scheduled = frequency !== 'irregular';
  // Semimonthly sources pay on two days of the month.
  const days = frequency === 'semimonthly' ? [Number(payDay), Number(secondPayDay)].sort((a, b) => a - b) : [Number(payDay)];
  const preview =
    scheduled && startDate && (!usesDays(frequency) || days.every((d) => d >= 1 && d <= 31))
      ? occurrencesBetween(
          { frequency, day: days[0]!, secondDay: days[1], startDate, weekendRule },
          today() > startDate ? today() : startDate,
          `${Number(today().slice(0, 4)) + 2}-12-31`,
        ).slice(0, 4)
      : [];
  const missingForAuto = autoRegister && (!accountId || !expectedGross || !scheduled);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (missingForAuto) return;
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
        payDay: scheduled && usesDays(frequency) ? days[0] : null,
        secondPayDay: frequency === 'semimonthly' ? days[1] : null,
        scheduleStartDate: scheduled ? startDate : null,
        weekendRule,
        expectedGross: expectedGross || null,
        autoRegister: scheduled && autoRegister,
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
        <Field label="Cuenta donde se recibe">{(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}</Field>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">Calendario de pago</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Frecuencia">
            {(id) => (
              <Select id={id} value={frequency} onChange={(e) => changeFrequency(e.target.value as PayFrequency)}>
                {PAY_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {PAY_FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {scheduled && (
            <Field
              label={frequency === 'weekly' || frequency === 'biweekly' ? 'Fecha del primer pago' : 'A partir de'}
              hint={frequency === 'quarterly' || frequency === 'yearly' ? 'El mes de esta fecha marca los meses de pago.' : undefined}
            >
              {(id) => <Input id={id} type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
            </Field>
          )}
          {scheduled && usesDays(frequency) && (
            <div className={frequency === 'semimonthly' ? 'grid grid-cols-2 gap-4' : ''}>
              <Field label={frequency === 'semimonthly' ? 'Primer día' : 'Día de pago'} hint="30 o 31 = último día del mes">
                {(id) => <Input id={id} type="number" min={1} max={31} required value={payDay} onChange={(e) => setPayDay(e.target.value)} />}
              </Field>
              {frequency === 'semimonthly' && (
                <Field label="Segundo día">
                  {(id) => <Input id={id} type="number" min={1} max={31} required value={secondPayDay} onChange={(e) => setSecondPayDay(e.target.value)} />}
                </Field>
              )}
            </div>
          )}
          {scheduled && (
            <Field label="Si cae en fin de semana">
              {(id) => (
                <Select id={id} value={weekendRule} onChange={(e) => setWeekendRule(e.target.value as WeekendRule)}>
                  {WEEKEND_RULES.map((r) => (
                    <option key={r} value={r}>
                      {WEEKEND_RULE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Monto bruto esperado por pago" hint="Se usa para registrar el pago y proyectar tu presupuesto.">
            {(id) => <MoneyInput id={id} value={expectedGross} onChange={(e) => setExpectedGross(e.target.value)} />}
          </Field>
        </div>
        {preview.length > 0 && (
          <p className="text-xs text-muted">
            Próximos pagos: {preview.map(formatShortDate).join(' · ')}
          </p>
        )}
        {scheduled && (
          <Checkbox
            label="Registrar automáticamente cada pago en la cuenta"
            checked={autoRegister}
            onChange={(e) => setAutoRegister(e.target.checked)}
          />
        )}
        {autoRegister && (
          <p className="text-xs text-muted">
            El día de pago se registra con el bruto esperado y los descuentos habituales; si el monto real cambia, lo ajustas en el pago.
          </p>
        )}
        {missingForAuto && <Notice>Para registrarlo automáticamente indica la cuenta y el monto bruto esperado.</Notice>}
      </fieldset>

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
        <Button type="submit" loading={saving} disabled={missingForAuto}>
          Guardar
        </Button>
      </div>
    </form>
  );
};
