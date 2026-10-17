import { FX_SIDES, type Currency, type FxPreferredSource, type FxSide } from '@mypersonalfinance/shared';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { CurrencySelect } from '../../components/finance';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Field, IconButton, Input, Notice, Segmented, Select, Spinner, Table, Td, Th } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { api } from '../../lib/api';
import { formatDate, today } from '../../lib/format';
import { useApiMutation, useFxRates, useMarketRates } from '../../lib/queries';
import type { MarketQuote } from '../../lib/types';

const SIDE_LABELS: Record<FxSide, string> = { buy: 'Compra', sell: 'Venta', mid: 'Promedio' };
const SOURCE_LABELS: Record<MarketQuote['source'], string> = {
  bcrd: 'Banco Central RD',
  ecb: 'Banco Central Europeo',
  erapi: 'ExchangeRate-API (respaldo)',
  infodolar: 'Infodolar',
};
const rate = (v: string | null) => (v ? Number(v).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—');

const MarketRatesCard = () => {
  const { isOwner, canWrite } = usePrefs();
  const market = useMarketRates();
  const savePreference = useApiMutation((payload: unknown) => api.patch('/household', payload), ['fx-rates', 'household']);
  const refresh = useApiMutation(() => api.post<{ errors: string[] }>('/fx-rates/refresh'), ['fx-rates']);

  if (market.isLoading || !market.data) return <Spinner />;
  const { preference, effective, quotes, lastFetchedAt } = market.data;
  const official = quotes.filter((q) => q.source !== 'infodolar');
  const entities = [...new Set(quotes.filter((q) => q.source === 'infodolar').map((q) => q.entity))].sort((a, b) =>
    a.startsWith('Promedio') ? -1 : b.startsWith('Promedio') ? 1 : a.localeCompare(b),
  );
  const entityQuote = (entity: string, currency: Currency) =>
    quotes.find((q) => q.source === 'infodolar' && q.entity === entity && q.fromCurrency === currency);
  const setPreference = (patch: Partial<typeof preference>) => savePreference.mutate({ ...preference, ...patch });

  return (
    <Card>
      <CardHeader
        title="Tasas de mercado"
        subtitle={`Se actualizan solas varias veces al día${lastFetchedAt ? ` · última: ${new Date(lastFetchedAt).toLocaleString('es-DO')}` : ''}`}
        actions={
          canWrite && (
            <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} loading={refresh.isPending} onClick={() => refresh.mutate(undefined)}>
              Actualizar ahora
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <ErrorBanner error={savePreference.error ?? refresh.error} />
        {refresh.data?.errors.length ? <Notice>No se pudo leer: {refresh.data.errors.join(' · ')}</Notice> : null}

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Fuente para pesos dominicanos">
            {(id) => (
              <Select
                id={id}
                disabled={!isOwner}
                value={preference.fxSource}
                onChange={(e) => {
                  const fxSource = e.target.value as FxPreferredSource;
                  setPreference(fxSource === 'infodolar' ? { fxSource, fxEntity: preference.fxEntity ?? entities[0] ?? null } : { fxSource });
                }}
              >
                <option value="bcrd">Banco Central (tasa oficial de referencia)</option>
                <option value="infodolar" disabled={entities.length === 0}>
                  Tasa de un banco o casa de cambio (Infodolar)
                </option>
              </Select>
            )}
          </Field>
          {preference.fxSource === 'infodolar' && (
            <Field label="Entidad">
              {(id) => (
                <Select id={id} disabled={!isOwner} value={preference.fxEntity ?? ''} onChange={(e) => setPreference({ fxEntity: e.target.value })}>
                  {entities.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Usar</span>
            <Segmented<FxSide>
              ariaLabel="Lado de la tasa"
              size="sm"
              value={preference.fxSide}
              onChange={(fxSide) => isOwner && setPreference({ fxSide })}
              options={FX_SIDES.map((s) => ({ value: s, label: SIDE_LABELS[s] }))}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'USD → DOP', value: effective.USD_DOP },
            { label: 'EUR → DOP', value: effective.EUR_DOP },
            { label: 'EUR → USD', value: effective.EUR_USD },
          ].map((k) => (
            <div key={k.label} className="rounded-lg bg-surface-2 p-3">
              <p className="text-xs text-muted">{k.label} hoy</p>
              <p className="tabular text-xl font-semibold">{rate(k.value)}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">
          EUR→DOP con el Banco Central se calcula con EUR→USD del Banco Central Europeo. Si una entidad de Infodolar no publica una moneda, se usa la tasa oficial.
        </p>
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Fuente</Th>
            <Th>Par</Th>
            <Th className="text-right">Compra</Th>
            <Th className="text-right">Venta</Th>
            <Th className="text-right">Promedio</Th>
            <Th>Fecha</Th>
          </tr>
        </thead>
        <tbody>
          {official.map((q) => (
            <tr key={`${q.source}-${q.fromCurrency}-${q.toCurrency}`}>
              <Td>{SOURCE_LABELS[q.source]}</Td>
              <Td>
                {q.fromCurrency} → {q.toCurrency}
              </Td>
              <Td className="tabular text-right">{rate(q.buy)}</Td>
              <Td className="tabular text-right">{rate(q.sell)}</Td>
              <Td className="tabular text-right">{rate(q.mid)}</Td>
              <Td>{formatDate(q.date)}</Td>
            </tr>
          ))}
          {entities.map((e) => {
            const usd = entityQuote(e, 'USD');
            const eur = entityQuote(e, 'EUR');
            return (
              <tr key={e}>
                <Td>
                  {e} {preference.fxSource === 'infodolar' && preference.fxEntity === e && <Badge tone="primary">En uso</Badge>}
                </Td>
                <Td className="text-xs text-muted">USD / EUR → DOP</Td>
                <Td className="tabular text-right">
                  {rate(usd?.buy ?? null)} / {rate(eur?.buy ?? null)}
                </Td>
                <Td className="tabular text-right">
                  {rate(usd?.sell ?? null)} / {rate(eur?.sell ?? null)}
                </Td>
                <Td className="tabular text-right">
                  {rate(usd?.mid ?? null)} / {rate(eur?.mid ?? null)}
                </Td>
                <Td>{formatDate((usd ?? eur)!.date)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
};

const ManualRatesCard = () => {
  const { canWrite } = usePrefs();
  const rates = useFxRates();
  const [f, setF] = useState({ date: today(), fromCurrency: 'USD' as Currency, toCurrency: 'DOP' as Currency, rate: '' });
  const save = useApiMutation((payload: unknown) => api.put('/fx-rates', payload), ['fx-rates']);
  const remove = useApiMutation(
    (key: { date: string; fromCurrency: string; toCurrency: string }) => api.del('/fx-rates', key),
    ['fx-rates'],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await save.mutateAsync({ ...f, rate: Number(f.rate) });
    setF({ ...f, rate: '' });
  };

  return (
    <Card>
      <CardHeader
        title="Ajustes manuales"
        subtitle="Opcional: una tasa manual tiene prioridad sobre la de mercado en su fecha (por ejemplo, la tasa real a la que cambiaste)."
      />
      {canWrite && (
        <form onSubmit={submit} className="grid gap-3 border-b border-border p-4 sm:grid-cols-5 sm:items-end sm:px-5">
          <Field label="Fecha">{(id) => <Input id={id} type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="1 unidad de">{(id) => <CurrencySelect id={id} value={f.fromCurrency} onChange={(fromCurrency) => setF({ ...f, fromCurrency })} />}</Field>
          <Field label="Equivale en">{(id) => <CurrencySelect id={id} value={f.toCurrency} onChange={(toCurrency) => setF({ ...f, toCurrency })} />}</Field>
          <Field label="Tasa">
            {(id) => <Input id={id} type="number" step="0.000001" min="0" required className="text-right" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />}
          </Field>
          <Button type="submit" loading={save.isPending} disabled={f.fromCurrency === f.toCurrency}>
            Guardar tasa
          </Button>
          <div className="sm:col-span-5">
            <ErrorBanner error={save.error} />
          </div>
        </form>
      )}
      {rates.isLoading ? (
        <Spinner />
      ) : !rates.data?.length ? (
        <EmptyState title="Sin ajustes manuales" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Par</Th>
              <Th className="text-right">Tasa</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rates.data.map((r) => (
              <tr key={`${r.date}-${r.fromCurrency}-${r.toCurrency}`}>
                <Td>{formatDate(r.date)}</Td>
                <Td>
                  1 {r.fromCurrency} = … {r.toCurrency}
                </Td>
                <Td className="tabular text-right">{rate(r.rate)}</Td>
                <Td className="text-right">
                  {canWrite && (
                    <IconButton
                      label="Eliminar tasa"
                      onClick={() => remove.mutate({ date: r.date, fromCurrency: r.fromCurrency, toCurrency: r.toCurrency })}
                      icon={<Trash2 className="size-4" />}
                    />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
};

export const FxRatesSettings = () => (
  <div className="flex flex-col gap-6">
    <MarketRatesCard />
    <ManualRatesCard />
  </div>
);
