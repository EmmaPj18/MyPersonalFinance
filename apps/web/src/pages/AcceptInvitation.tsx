import { CURRENCIES, type Currency, type UserRole } from '@mypersonalfinance/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, ErrorBanner, Field, Input, Notice, Select, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { CURRENCY_LABELS, ROLE_LABELS } from '../lib/format';
import { useMe } from '../lib/queries';
import { AuthShell } from './Auth';

interface InvitationInfo {
  email: string;
  role: UserRole;
  householdName: string;
  invitedByName: string;
  hasAccount: boolean;
  /** Set when the invitation is to take over a member without an account. */
  memberName: string | null;
}

export const AcceptInvitationPage = () => {
  const { token } = useParams();
  const me = useMe();
  const info = useQuery({ queryKey: ['invitation', token], queryFn: () => api.get<InvitationInfo>(`/invitations/${token}`), retry: false });
  const [form, setForm] = useState({ name: '', password: '', defaultCurrency: 'DOP' as Currency });
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  if (info.isLoading || me.isLoading) return <Spinner />;
  if (info.error || !info.data) {
    return (
      <AuthShell title="Invitación no válida">
        <p className="text-sm text-muted">La invitación expiró, ya fue usada o fue revocada.</p>
        <Link to="/" className="mt-4 inline-block text-sm font-medium text-primary">
          Ir al inicio
        </Link>
      </AuthShell>
    );
  }
  const inv = info.data;
  const loggedAsInvited = me.data?.email.toLowerCase() === inv.email.toLowerCase();

  const accept = async (e?: FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post(`/invitations/${token}/accept`, inv.hasAccount ? {} : { ...form, name: form.name.trim() || undefined });
      // The invitation is used now: refresh everything except it.
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'invitation' });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={`Únete a "${inv.householdName}"`}
      subtitle={
        inv.memberName
          ? `${inv.invitedByName} te invitó a tomar la cuenta de "${inv.memberName}" (${inv.email}). Conservarás todo lo que ya está registrado a ese nombre.`
          : `${inv.invitedByName} te invitó como ${ROLE_LABELS[inv.role].toLowerCase()} (${inv.email}).`
      }
    >
      <div className="flex flex-col gap-4">
        <ErrorBanner error={error} />
        {inv.hasAccount ? (
          loggedAsInvited ? (
            <>
              <Notice>
                Saldrás de tu hogar actual (<strong>{me.data!.household.name}</strong>). Te llevarás tus ingresos, gastos, cuentas,
                metas y deudas personales; lo compartido se queda en ese hogar.
              </Notice>
              <Button onClick={() => accept()} loading={loading}>
                Cambiarme a este hogar
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Ya existe una cuenta con {inv.email}. Inicia sesión con ella para aceptar.</p>
              <Link to="/login" state={{ from: `/invitations/${token}` }} className="text-sm font-medium text-primary">
                Iniciar sesión
              </Link>
            </>
          )
        ) : (
          <form onSubmit={accept} className="flex flex-col gap-4">
            <Field label="Tu nombre">
              {(id) => (
                <Input
                  id={id}
                  required={!inv.memberName}
                  placeholder={inv.memberName ?? undefined}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Contraseña" hint="Mínimo 8 caracteres">
              {(id) => (
                <Input id={id} type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              )}
            </Field>
            <Field label="Moneda por defecto">
              {(id) => (
                <Select id={id} value={form.defaultCurrency} onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value as Currency })}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {CURRENCY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button type="submit" loading={loading}>
              Crear cuenta y unirme
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
};
