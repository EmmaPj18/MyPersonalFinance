import type { Currency, ImportMapping } from '@mypersonalfinance/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';
import { AccountSelect, CurrencySelect, Money } from '../../components/finance';
import { Badge, Button, ErrorBanner, Field, Input, Modal, Notice, Segmented, Select, Table, Td, Th } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { ParsedImport } from '../../lib/types';

type Column = keyof ImportMapping['columns'];

const FIELDS: { key: Column; label: string; hint?: string }[] = [
  { key: 'date', label: 'Fecha' },
  { key: 'description', label: 'Descripción' },
  { key: 'amount', label: 'Monto', hint: 'Una sola columna con signo' },
  { key: 'debit', label: 'Débito / cargo', hint: 'Si el banco separa débitos…' },
  { key: 'credit', label: 'Crédito / abono', hint: '…y créditos' },
  { key: 'currency', label: 'Moneda' },
  { key: 'type', label: 'Tipo (Gasto/Ingreso)' },
  { key: 'category', label: 'Categoría' },
  { key: 'owner', label: 'De (Hogar / persona)' },
  { key: 'account', label: 'Cuenta' },
];

interface Preview {
  preview: { row: number; date: string; description: string; amount: string; direction: 'debit' | 'credit'; currency: Currency }[];
  total: number;
  errors: { row: number; message: string }[];
}

/** Upload → map columns → preview → send to "Por revisar". */
export const ImportWizard = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { me } = usePrefs();
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const file = files[0] ?? null;
  const emails = files.length > 0 && files.every((f) => /\.eml$/i.test(f.name));
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>(me.defaultCurrency);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [profileName, setProfileName] = useState('');
  const [result, setResult] = useState<{ added: number; duplicates: number; errors?: unknown[]; skipped?: { subject: string }[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFiles([]);
    setParsed(null);
    setMapping(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setProfileName('');
  };
  const close = () => {
    reset();
    onClose();
  };
  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** Bank notifications go straight to the inbox. */
  const sendEmails = () =>
    run(async () => {
      setResult(await api.upload('/import/email', files));
      await qc.invalidateQueries({ queryKey: ['inbox'] });
    });

  const read = () =>
    run(async () => {
      if (files.length > 1) throw new Error('Varios archivos solo se pueden subir si todos son correos (.eml)');
      const res = await api.upload<ParsedImport>('/import/parse', file!);
      setParsed(res);
      setMapping(res.suggested);
      setProfileName(res.profileName ?? '');
      setPreview(null);
    });

  const body = (dryRun: boolean) => ({
    fileName: parsed!.fileName,
    source: parsed!.source,
    rows: parsed!.rows,
    mapping,
    accountId,
    currency,
    dryRun,
    ...(profileName.trim() && !dryRun ? { saveProfileAs: profileName.trim() } : {}),
  });

  const setColumn = (key: Column, value: string) =>
    setMapping((m) => {
      const columns = { ...m!.columns, [key]: value || undefined };
      // Amount and debit/credit are alternatives.
      if (key === 'amount' && value) Object.assign(columns, { debit: undefined, credit: undefined });
      if ((key === 'debit' || key === 'credit') && value) columns.amount = undefined;
      return { ...m!, columns };
    });

  return (
    <Modal open={open} onClose={close} title="Importar movimientos (Excel, CSV o correos)" wide>
      <div className="flex flex-col gap-4">
        <ErrorBanner error={error} />
        {result ? (
          <>
            <Notice tone="primary">
              {result.added} transacciones agregadas a "Por revisar".
              {result.duplicates > 0 && ` ${result.duplicates} ya estaban importadas y se omitieron.`}
              {(result.errors?.length ?? 0) > 0 && ` ${result.errors!.length} filas no se pudieron leer.`}
              {(result.skipped?.length ?? 0) > 0 && ` ${result.skipped!.length} correos no son notificaciones de transacciones que sepamos leer.`}
            </Notice>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={reset}>
                Importar otro archivo
              </Button>
              <Button onClick={close}>Revisar ahora</Button>
            </div>
          </>
        ) : !parsed ? (
          <>
            <p className="text-sm text-muted">
              Sube el estado de cuenta exportado de tu banco (.xlsx o .csv), la plantilla de MyPersonalFinance o correos de notificación del banco
              (.eml, puedes elegir varios). Las transacciones no se registran hasta que las revises.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FileSpreadsheet className="size-4 text-muted" aria-hidden />
              Plantilla:
              <a className="font-medium text-primary hover:underline" href="/api/import/template.xlsx">
                Excel
              </a>
              ·
              <a className="font-medium text-primary hover:underline" href="/api/import/template.csv">
                CSV
              </a>
            </div>
            <Field label="Archivo">
              {(id) => <Input id={id} type="file" multiple accept=".xlsx,.csv,.txt,.eml" onChange={(e) => setFiles([...(e.target.files ?? [])])} />}
            </Field>
            <div className="flex justify-end">
              {emails ? (
                <Button icon={<Upload className="size-4" />} loading={busy} onClick={sendEmails}>
                  Enviar {files.length === 1 ? 'correo' : `${files.length} correos`} a "Por revisar"
                </Button>
              ) : (
                <Button icon={<Upload className="size-4" />} disabled={!file} loading={busy} onClick={read}>
                  Leer archivo
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              <strong className="text-text">{parsed.fileName}</strong>: {parsed.rows.length} filas.{' '}
              {parsed.profileName && <Badge tone="primary">Formato reconocido: {parsed.profileName}</Badge>}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cuenta del estado (opcional)" hint="Para asociar los movimientos y detectar duplicados.">
                {(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}
              </Field>
              <Field label="Moneda si el archivo no la indica">{(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}</Field>
            </div>
            <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="px-1 text-sm font-medium">¿Qué columna es cada dato?</legend>
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  {(id) => (
                    <Select id={id} value={mapping?.columns[f.key] ?? ''} onChange={(e) => setColumn(f.key, e.target.value)}>
                      <option value="">—</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
            </fieldset>
            <div className="flex flex-wrap gap-6">
              {mapping?.columns.amount && !mapping.columns.type && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Los gastos aparecen como</span>
                  <Segmented<ImportMapping['amountSign']>
                    ariaLabel="Signo de los gastos"
                    size="sm"
                    value={mapping.amountSign}
                    onChange={(amountSign) => setMapping({ ...mapping, amountSign })}
                    options={[
                      { value: 'negative-is-debit', label: 'Negativos' },
                      { value: 'positive-is-debit', label: 'Positivos' },
                    ]}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Formato de fecha</span>
                <Segmented<ImportMapping['dateFormat']>
                  ariaLabel="Formato de fecha"
                  size="sm"
                  value={mapping!.dateFormat}
                  onChange={(dateFormat) => setMapping({ ...mapping!, dateFormat })}
                  options={[
                    { value: 'auto', label: 'Automático' },
                    { value: 'dmy', label: 'Día/Mes/Año' },
                    { value: 'mdy', label: 'Mes/Día/Año' },
                  ]}
                />
              </div>
            </div>

            {preview && (
              <>
                <p className="text-sm">
                  {preview.total} transacciones listas{preview.errors.length > 0 && `, ${preview.errors.length} filas con problemas`}.
                </p>
                {preview.errors.length > 0 && (
                  <Notice>
                    {preview.errors
                      .slice(0, 5)
                      .map((e) => `Fila ${e.row}: ${e.message}`)
                      .join(' · ')}
                  </Notice>
                )}
                <Table>
                  <thead>
                    <tr>
                      <Th>Fecha</Th>
                      <Th>Descripción</Th>
                      <Th className="text-right">Monto</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.slice(0, 8).map((r) => (
                      <tr key={r.row}>
                        <Td className="whitespace-nowrap">{formatDate(r.date)}</Td>
                        <Td>{r.description}</Td>
                        <Td className={`text-right ${r.direction === 'credit' ? 'text-success' : ''}`}>
                          {r.direction === 'credit' ? '+' : '−'}
                          <Money value={r.amount} currency={r.currency} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Field label="Guardar este formato como (opcional)" hint="La próxima vez se reconocen las columnas solas.">
                  {(id) => <Input id={id} placeholder="Ej. Popular cuenta corriente" value={profileName} onChange={(e) => setProfileName(e.target.value)} />}
                </Field>
              </>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={reset}>
                Cambiar archivo
              </Button>
              <Button
                variant="secondary"
                loading={busy && !preview}
                onClick={() => run(async () => setPreview(await api.post<Preview>('/import/batches', body(true))))}
              >
                Vista previa
              </Button>
              <Button
                disabled={!preview || preview.total === 0}
                loading={busy && Boolean(preview)}
                onClick={() =>
                  run(async () => {
                    setResult(await api.post('/import/batches', body(false)));
                    await qc.invalidateQueries({ queryKey: ['inbox'] });
                  })
                }
              >
                Enviar a "Por revisar"
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
