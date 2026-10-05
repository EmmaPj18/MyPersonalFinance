import type { Currency } from '@mypersonalfinance/shared';
import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { CurrencySelect } from '../../components/finance';
import { Button, Card, CardHeader, EmptyState, ErrorBanner, Field, IconButton, Input, Spinner, Table, Td, Th } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { api } from '../../lib/api';
import { formatDate, today } from '../../lib/format';
import { useApiMutation, useFxRates } from '../../lib/queries';

export const FxRatesSettings = () => {
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
        title="Tasas de cambio"
        subtitle="Los reportes usan la tasa más reciente en o antes de la fecha de cada movimiento. Basta una dirección (ej. USD→DOP); la inversa se calcula."
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
        <EmptyState title="Sin tasas registradas" description="Agrega al menos USD→DOP y EUR→DOP para combinar monedas en los reportes." />
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
                <Td className="tabular text-right">{Number(r.rate).toLocaleString('es-DO', { maximumFractionDigits: 6 })}</Td>
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
