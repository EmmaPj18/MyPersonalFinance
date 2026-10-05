import type { IncomeKind } from '@mypersonalfinance/shared';
import { Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Money, OwnerBadge } from '../components/finance';
import { MonthPicker } from '../components/layout/AppLayout';
import { Badge, Button, Card, CardHeader, EmptyState, IconButton, Modal, Notice, PageHeader, Spinner, Table, Td, Th } from '../components/ui';
import { usePrefs } from '../context/prefs';
import { api } from '../lib/api';
import { formatDate, formatMonth, formatPct, INCOME_KIND_LABELS, PAY_FREQUENCY_LABELS, SOURCE_TYPE_LABELS } from '../lib/format';
import { useApiMutation, useDeductionTypes, useIncomeEntries, useIncomeSources, useMonthlyReport } from '../lib/queries';
import type { IncomeEntry, IncomeSource } from '../lib/types';
import { IncomeEntryForm, type IncomeEntryPayload } from './income/IncomeEntryForm';
import { SourceForm } from './income/SourceForm';

type EntryModal = { mode: 'new'; sourceId?: string; kind?: IncomeKind } | { mode: 'edit'; entry: IncomeEntry } | null;

export const IncomePage = () => {
  const { month, currency, view, canWrite, me } = usePrefs();
  const sources = useIncomeSources();
  const deductionTypes = useDeductionTypes();
  const entries = useIncomeEntries({ month });
  const report = useMonthlyReport(month, currency, view);
  const [sourceModal, setSourceModal] = useState<IncomeSource | 'new' | null>(null);
  const [entryModal, setEntryModal] = useState<EntryModal>(null);

  const saveSource = useApiMutation(
    ({ id, payload }: { id?: string; payload: unknown }) =>
      id ? api.put(`/income-sources/${id}`, payload) : api.post('/income-sources', payload),
    ['income-sources'],
  );
  const deleteSource = useApiMutation((id: string) => api.del(`/income-sources/${id}`), ['income-sources', 'income-entries']);
  const saveEntry = useApiMutation(
    ({ id, payload }: { id?: string; payload: IncomeEntryPayload }) =>
      id ? api.put(`/income-entries/${id}`, payload) : api.post('/income-entries', payload),
    ['income-entries'],
  );
  const deleteEntry = useApiMutation((id: string) => api.del(`/income-entries/${id}`), ['income-entries']);

  // In "Mis finanzas" show my personal incomes and the shared ones.
  const visibleEntries = (entries.data ?? []).filter((e) => view === 'household' || e.scope === 'shared' || e.ownerUserId === me.id);
  const activeSources = (sources.data ?? []).filter((s) => s.isActive);
  const summary = report.data?.income;

  return (
    <>
      <PageHeader
        title="Ingresos"
        subtitle="Sueldos, bonos, freelance e ingresos del hogar, con su desglose bruto y neto."
        actions={
          <>
            <MonthPicker />
            {canWrite && (
              <Button icon={<Plus className="size-4" />} disabled={!activeSources.length} onClick={() => setEntryModal({ mode: 'new' })}>
                Registrar pago
              </Button>
            )}
          </>
        }
      />

      {summary && (
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          {[
            { label: 'Bruto', value: summary.gross },
            { label: 'Descuentos', value: summary.deductions, tone: 'text-danger' },
            { label: 'Neto', value: summary.net, tone: 'text-success' },
          ].map((k) => (
            <Card key={k.label} className="p-4">
              <p className="text-sm text-muted">{k.label}</p>
              <p className={`mt-1 text-xl font-semibold ${k.tone ?? ''}`}>
                <Money value={k.value} currency={currency} />
              </p>
            </Card>
          ))}
          <Card className="p-4">
            <p className="text-sm text-muted">Tasa efectiva de descuentos</p>
            <p className="mt-1 text-xl font-semibold">{formatPct(summary.effectiveDeductionRate)}</p>
          </Card>
        </div>
      )}
      {report.data?.missingRates.length ? (
        <div className="mb-4">
          <Notice>Faltan tasas de cambio ({report.data.missingRates.join(', ')}); algunos montos no se incluyeron en los totales.</Notice>
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title={`Pagos de ${formatMonth(month)}`} />
          {entries.isLoading ? (
            <Spinner />
          ) : visibleEntries.length === 0 ? (
            <EmptyState title="Sin pagos registrados este mes" description="Registra tu salario, bonos o pagos de freelance." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Fuente</Th>
                  <Th>Tipo</Th>
                  <Th>De</Th>
                  <Th className="text-right">Bruto</Th>
                  <Th className="text-right">Descuentos</Th>
                  <Th className="text-right">Neto</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap">{formatDate(e.payDate)}</Td>
                    <Td>{e.sourceName}</Td>
                    <Td>
                      <Badge tone={e.kind === 'bonus' ? 'warning' : 'neutral'}>{INCOME_KIND_LABELS[e.kind]}</Badge>
                    </Td>
                    <Td>
                      <OwnerBadge scope={e.scope} ownerUserId={e.ownerUserId} />
                    </Td>
                    <Td className="text-right">
                      <Money value={e.grossAmount} currency={e.currency} />
                    </Td>
                    <Td className="text-right text-danger">
                      <span title={e.deductions.map((d) => `${d.name}: ${d.amount}`).join('\n')}>
                        <Money value={(Number(e.grossAmount) - Number(e.netAmount)).toFixed(2)} currency={e.currency} />
                      </span>
                    </Td>
                    <Td className="text-right font-medium">
                      <Money value={e.netAmount} currency={e.currency} />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {canWrite && (
                        <>
                          <IconButton label="Editar" onClick={() => setEntryModal({ mode: 'edit', entry: e })} icon={<Pencil className="size-4" />} />
                          <IconButton
                            label="Eliminar"
                            onClick={() => confirm('¿Eliminar este pago?') && deleteEntry.mutate(e.id)}
                            icon={<Trash2 className="size-4" />}
                          />
                        </>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Fuentes de ingreso"
            subtitle="Empleos, freelance, inversiones y ahorros en común."
            actions={
              canWrite && (
                <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setSourceModal('new')}>
                  Nueva fuente
                </Button>
              )
            }
          />
          {sources.isLoading ? (
            <Spinner />
          ) : !sources.data?.length ? (
            <EmptyState
              title="Aún no tienes fuentes de ingreso"
              description="Crea una por cada empleo, cliente freelance o inversión."
              action={canWrite && <Button onClick={() => setSourceModal('new')}>Crear fuente</Button>}
            />
          ) : (
            <ul className="divide-y divide-border">
              {sources.data.map((s) => {
                const bySource = summary?.bySource.find((b) => b.sourceId === s.id);
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {s.name} {!s.isActive && <Badge>Inactiva</Badge>}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <Badge>{SOURCE_TYPE_LABELS[s.type]}</Badge>
                        <OwnerBadge scope={s.scope} ownerUserId={s.ownerUserId} />
                        <span>
                          {PAY_FREQUENCY_LABELS[s.payFrequency]} · {s.defaultCurrency}
                        </span>
                      </div>
                    </div>
                    {bySource && (
                      <div className="text-right text-sm">
                        <p className="text-muted">Neto del mes</p>
                        <p className="font-medium">
                          <Money value={bySource.net} currency={currency} />
                        </p>
                      </div>
                    )}
                    {canWrite && (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setEntryModal({ mode: 'new', sourceId: s.id })}>
                          Registrar pago
                        </Button>
                        {(s.type === 'formal_employment' || s.type === 'informal_employment') && (
                          <IconButton
                            label="Registrar bono"
                            onClick={() => setEntryModal({ mode: 'new', sourceId: s.id, kind: 'bonus' })}
                            icon={<Gift className="size-4" />}
                          />
                        )}
                        <IconButton label="Editar fuente" onClick={() => setSourceModal(s)} icon={<Pencil className="size-4" />} />
                        <IconButton
                          label="Eliminar fuente"
                          onClick={() => confirm(`¿Eliminar "${s.name}" y todos sus pagos?`) && deleteSource.mutate(s.id)}
                          icon={<Trash2 className="size-4" />}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={sourceModal !== null} onClose={() => setSourceModal(null)} title={sourceModal === 'new' ? 'Nueva fuente de ingreso' : 'Editar fuente'}>
        {sourceModal !== null && (
          <SourceForm
            initial={sourceModal === 'new' ? undefined : sourceModal}
            deductionTypes={deductionTypes.data ?? []}
            onCancel={() => setSourceModal(null)}
            onSubmit={async (payload) => {
              await saveSource.mutateAsync({ id: sourceModal === 'new' ? undefined : sourceModal.id, payload });
              setSourceModal(null);
            }}
          />
        )}
      </Modal>

      <Modal
        open={entryModal !== null}
        onClose={() => setEntryModal(null)}
        title={entryModal?.mode === 'edit' ? 'Editar pago' : entryModal?.kind === 'bonus' ? 'Registrar bono' : 'Registrar pago'}
        wide
      >
        {entryModal && (
          <IncomeEntryForm
            sources={entryModal.mode === 'edit' ? (sources.data ?? []) : activeSources}
            deductionTypes={deductionTypes.data ?? []}
            initial={entryModal.mode === 'edit' ? entryModal.entry : undefined}
            defaultSourceId={entryModal.mode === 'new' ? entryModal.sourceId : undefined}
            defaultKind={entryModal.mode === 'new' ? entryModal.kind : undefined}
            onCancel={() => setEntryModal(null)}
            onSubmit={async (payload) => {
              await saveEntry.mutateAsync({ id: entryModal.mode === 'edit' ? entryModal.entry.id : undefined, payload });
              setEntryModal(null);
            }}
          />
        )}
      </Modal>
    </>
  );
};
