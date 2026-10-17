import { USER_ROLES, type Currency, type PrivacyMode, type UserRole } from '@mypersonalfinance/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, LogOut, Mail, Trash2, UserPlus, UserRoundPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { CurrencySelect } from '../../components/finance';
import { Badge, Button, Card, CardHeader, ErrorBanner, Field, IconButton, Input, Modal, Notice, Segmented, Select, Spinner, Table, Td, Th } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { api } from '../../lib/api';
import { formatDate, ROLE_LABELS } from '../../lib/format';
import { useApiMutation, useHousehold, useInvitations, useLeavePreview } from '../../lib/queries';

const PREVIEW_LABELS: Record<string, string> = {
  accounts: 'cuentas',
  incomeSources: 'fuentes de ingreso',
  incomeEntries: 'pagos de ingreso',
  personalExpenses: 'gastos personales',
  recurringExpenses: 'gastos fijos personales',
  savingsGoals: 'metas',
  debts: 'deudas',
  sharedExpenses: 'gastos comunes',
  sharedIncomeSources: 'fuentes de ingreso comunes',
};

const describe = (counts: Record<string, number>) =>
  Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${PREVIEW_LABELS[k] ?? k}`)
    .join(', ') || 'nada';

export const HouseholdSettings = () => {
  const { me, isOwner } = usePrefs();
  const household = useHousehold();
  const invitations = useInvitations(isOwner);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('member');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [managedName, setManagedName] = useState('');
  const [claim, setClaim] = useState<{ id: string; name: string } | null>(null);
  const [claimEmail, setClaimEmail] = useState('');
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const preview = useLeavePreview(leaveOpen);

  const refreshAll = () => qc.invalidateQueries();
  const updateHousehold = useApiMutation((payload: unknown) => api.patch('/household', payload), ['household', 'me']);
  const updateMember = useApiMutation(({ id, payload }: { id: string; payload: unknown }) => api.patch(`/household/members/${id}`, payload), ['household', 'me']);
  const removeMember = useApiMutation((id: string) => api.del(`/household/members/${id}`), ['household']);
  const transfer = useApiMutation((userId: string) => api.post('/household/transfer-ownership', { userId }), ['household', 'me']);
  const addManaged = useApiMutation((name: string) => api.post('/household/members', { name }), ['household']);
  const inviteClaim = useApiMutation(
    ({ id, email }: { id: string; email: string }) => api.post<{ url: string }>(`/household/members/${id}/invite`, { email }),
    ['invitations'],
  );
  const invite = useApiMutation((payload: unknown) => api.post<{ url: string }>('/household/invitations', payload), ['invitations']);
  const revoke = useApiMutation((id: string) => api.del(`/household/invitations/${id}`), ['invitations']);
  const leave = useApiMutation(() => api.post('/household/leave'), []);

  if (household.isLoading || !household.data) return <Spinner />;
  const h = household.data;

  const submitInvite = async (e: FormEvent) => {
    e.preventDefault();
    const res = await invite.mutateAsync({ email: inviteEmail, role: inviteRole });
    setInviteUrl(res.url);
    setInviteEmail('');
  };

  const splitSum = h.members.reduce((acc, m) => acc + (m.defaultSplitPct === null ? NaN : Number(m.defaultSplitPct)), 0);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Hogar" />
        <div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <ErrorBanner error={updateHousehold.error} />
          <Field label="Nombre">
            {(id) => (
              <Input
                id={id}
                defaultValue={h.name}
                disabled={!isOwner}
                onBlur={(e) => e.target.value !== h.name && e.target.value && updateHousehold.mutate({ name: e.target.value })}
              />
            )}
          </Field>
          <Field label="Moneda base">
            {(id) =>
              isOwner ? (
                <CurrencySelect id={id} value={h.baseCurrency} onChange={(baseCurrency: Currency) => updateHousehold.mutate({ baseCurrency })} />
              ) : (
                <Input id={id} value={h.baseCurrency} disabled />
              )
            }
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Privacidad de lo personal</span>
            <Segmented<PrivacyMode>
              ariaLabel="Privacidad"
              size="sm"
              value={h.privacyMode}
              onChange={(privacyMode) => isOwner && updateHousehold.mutate({ privacyMode })}
              options={[
                { value: 'open', label: 'Todos ven todo' },
                { value: 'aggregated', label: 'Solo totales' },
              ]}
            />
            <p className="text-xs text-muted">
              Con "Solo totales", los gastos e ingresos personales de cada uno no se ven en detalle, pero sí cuentan en los resúmenes del hogar.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Miembros"
          subtitle={
            Number.isNaN(splitSum) || Math.abs(splitSum - 100) > 0.001
              ? 'Reparto por defecto: partes iguales (define % para todos que sumen 100 para personalizarlo).'
              : 'Reparto por defecto personalizado.'
          }
        />
        <ErrorBanner error={updateMember.error ?? removeMember.error ?? transfer.error} />
        <Table>
          <thead>
            <tr>
              <Th>Nombre</Th>
              <Th>Rol</Th>
              <Th>Reparto por defecto</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {h.members.map((m) => (
              <tr key={m.id}>
                <Td>
                  {m.accountStatus === 'managed' && isOwner ? (
                    <Input
                      aria-label={`Nombre de ${m.name}`}
                      className="!h-8 max-w-56"
                      defaultValue={m.name}
                      onBlur={(e) => e.target.value && e.target.value !== m.name && updateMember.mutate({ id: m.id, payload: { name: e.target.value } })}
                    />
                  ) : (
                    <p className="font-medium">
                      {m.name} {m.id === me.id && <Badge tone="primary">Tú</Badge>}
                    </p>
                  )}
                  {m.accountStatus === 'managed' ? (
                    <p className="mt-1">
                      <Badge tone="warning">Sin cuenta</Badge>
                    </p>
                  ) : (
                    <p className="text-xs text-muted">{m.email}</p>
                  )}
                </Td>
                <Td>
                  {m.accountStatus === 'managed' ? (
                    <span className="text-xs text-muted">Solo lo del hogar</span>
                  ) : isOwner ? (
                    <Select
                      aria-label={`Rol de ${m.name}`}
                      className="!h-8 !w-auto text-xs"
                      value={m.role}
                      onChange={(e) => updateMember.mutate({ id: m.id, payload: { role: e.target.value } })}
                    >
                      {USER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    ROLE_LABELS[m.role]
                  )}
                </Td>
                <Td>
                  <div className="flex w-28 items-center gap-1">
                    <Input
                      aria-label={`Reparto de ${m.name}`}
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      className="!h-8 text-right"
                      disabled={!isOwner}
                      defaultValue={m.defaultSplitPct ?? ''}
                      placeholder="igual"
                      onBlur={(e) =>
                        updateMember.mutate({ id: m.id, payload: { defaultSplitPct: e.target.value === '' ? null : Number(e.target.value) } })
                      }
                    />
                    <span className="text-sm text-muted">%</span>
                  </div>
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {isOwner && m.id !== me.id && (
                    <>
                      {m.accountStatus === 'managed' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Mail className="size-4" />}
                          onClick={() => {
                            setClaim({ id: m.id, name: m.name });
                            setClaimEmail('');
                            setClaimUrl(null);
                          }}
                        >
                          Invitar a tomar la cuenta
                        </Button>
                      )}
                      {m.role !== 'owner' && m.accountStatus === 'active' && (
                        <Button size="sm" variant="ghost" onClick={() => confirm(`¿Transferir la propiedad del hogar a ${m.name}? Pasarás a ser miembro.`) && transfer.mutate(m.id)}>
                          Hacer dueño
                        </Button>
                      )}
                      <IconButton
                        label="Quitar del hogar"
                        onClick={() =>
                          confirm(
                            m.accountStatus === 'managed'
                              ? `¿Eliminar a ${m.name}? Solo es posible si no participa en gastos o ingresos.`
                              : `¿Quitar a ${m.name}? Se llevará sus datos personales a un hogar propio; lo común se queda aquí.`,
                          ) && removeMember.mutate(m.id)
                        }
                        icon={<Trash2 className="size-4" />}
                      />
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {isOwner && (
          <form
            className="flex flex-wrap items-end gap-2 border-t border-border px-4 py-3 sm:px-5"
            onSubmit={async (e) => {
              e.preventDefault();
              await addManaged.mutateAsync(managedName);
              setManagedName('');
            }}
          >
            <Field label="Agregar miembro sin cuenta" hint="Participa en el presupuesto del hogar; más adelante puedes invitarle a tomar su cuenta." className="min-w-60 flex-1">
              {(id) => <Input id={id} required placeholder="Nombre" value={managedName} onChange={(e) => setManagedName(e.target.value)} />}
            </Field>
            <Button type="submit" variant="secondary" icon={<UserRoundPlus className="size-4" />} loading={addManaged.isPending}>
              Agregar
            </Button>
            <div className="w-full">
              <ErrorBanner error={addManaged.error} />
            </div>
          </form>
        )}
        {h.exMembers.length > 0 && (
          <p className="px-4 py-3 text-xs text-muted sm:px-5">
            Ex-miembros: {h.exMembers.map((m) => `${m.name} (salió el ${formatDate(m.leftAt)})`).join(', ')}
          </p>
        )}
      </Card>

      {isOwner && (
        <Card>
          <CardHeader title="Invitar a alguien" subtitle="Comparte el enlace generado. Si ya tiene cuenta en otro hogar, al aceptar se cambiará a este." />
          <form onSubmit={submitInvite} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:p-5">
            <Field label="Email" className="flex-1">
              {(id) => <Input id={id} type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />}
            </Field>
            <Field label="Rol">
              {(id) => (
                <Select id={id} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)}>
                  {USER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button type="submit" icon={<UserPlus className="size-4" />} loading={invite.isPending}>
              Generar invitación
            </Button>
          </form>
          <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
            <ErrorBanner error={invite.error} />
            {inviteUrl && (
              <Notice tone="primary">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all text-xs">{inviteUrl}</code>
                  <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard?.writeText(inviteUrl)}>
                    Copiar
                  </Button>
                </div>
              </Notice>
            )}
            {(invitations.data ?? []).length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {invitations.data!.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="flex-1">{i.email}</span>
                    <Badge>{ROLE_LABELS[i.role]}</Badge>
                    <span className="text-xs text-muted">vence {formatDate(i.expiresAt)}</span>
                    <IconButton label="Revocar invitación" onClick={() => revoke.mutate(i.id)} icon={<Trash2 className="size-4" />} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Salir del hogar" subtitle="Te llevas tus datos personales a un hogar propio; lo compartido se queda aquí." />
        <div className="p-4 sm:p-5">
          <Button variant="danger" icon={<LogOut className="size-4" />} onClick={() => setLeaveOpen(true)}>
            Salir del hogar
          </Button>
        </div>
      </Card>

      <Modal open={claim !== null} onClose={() => setClaim(null)} title={`Invitar a tomar la cuenta de ${claim?.name ?? ''}`}>
        {claim && (
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await inviteClaim.mutateAsync({ id: claim.id, email: claimEmail });
              setClaimUrl(res.url);
            }}
          >
            <p className="text-sm text-muted">
              La persona crea su cuenta (o usa la que ya tiene) y conserva todo lo registrado a nombre de {claim.name}.
            </p>
            <ErrorBanner error={inviteClaim.error} />
            <Field label="Email">{(id) => <Input id={id} type="email" required value={claimEmail} onChange={(e) => setClaimEmail(e.target.value)} />}</Field>
            {claimUrl ? (
              <Notice tone="primary">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all text-xs">{claimUrl}</code>
                  <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard?.writeText(claimUrl)}>
                    Copiar
                  </Button>
                </div>
              </Notice>
            ) : (
              <div className="flex justify-end">
                <Button type="submit" loading={inviteClaim.isPending}>
                  Generar invitación
                </Button>
              </div>
            )}
          </form>
        )}
      </Modal>

      <Modal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title={`Salir de "${h.name}"`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLeaveOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={leave.isPending}
              onClick={async () => {
                await leave.mutateAsync(undefined);
                setLeaveOpen(false);
                await refreshAll();
                navigate('/');
              }}
            >
              Salir del hogar
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <ErrorBanner error={leave.error} />
          {preview.isLoading || !preview.data ? (
            <Spinner />
          ) : (
            <>
              <p>
                <strong>Te llevas:</strong> {describe(preview.data.moves)}.
              </p>
              <p>
                <strong>Se queda en el hogar:</strong> {describe(preview.data.stays)} (seguirás apareciendo como ex-miembro en ellos).
              </p>
              <p className="text-muted">Se creará un hogar nuevo donde serás dueño. Luego puedes aceptar una invitación a otro hogar.</p>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};
