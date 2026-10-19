import { useQuery } from '@tanstack/react-query';
import { Mail, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, Notice, Spinner } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { api } from '../../lib/api';
import { formatDate, today } from '../../lib/format';
import { useApiMutation } from '../../lib/queries';

interface EmailConnection {
  id: string;
  host: string;
  port: number;
  username: string;
  mailbox: string;
  sinceDate: string;
  active: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface SyncResult {
  recognized: number;
  added: number;
  duplicates: number;
}

const firstOfMonth = () => `${today().slice(0, 7)}-01`;
const formatDateTime = (iso: string) => new Date(iso).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' });

const ConnectionForm = ({ onSubmit, onCancel }: { onSubmit: (p: unknown) => Promise<unknown>; onCancel: () => void }) => {
  const { me } = usePrefs();
  const [f, setF] = useState({ username: me.email, password: '', sinceDate: firstOfMonth(), host: 'imap.gmail.com', port: '993', mailbox: 'INBOX' });
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ ...f, password: f.password.replace(/\s+/g, ''), port: Number(f.port) });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ErrorBanner error={error} />
      <Notice tone="primary">
        En Gmail: activa la verificación en 2 pasos y crea una <strong>contraseña de aplicación</strong> en{' '}
        <a className="font-medium underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
          myaccount.google.com/apppasswords
        </a>
        . Úsala aquí en lugar de tu contraseña; se guarda cifrada y solo se usa para leer los correos de los bancos.
      </Notice>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Correo">{(id) => <Input id={id} type="email" required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />}</Field>
        <Field label="Contraseña de aplicación">
          {(id) => <Input id={id} type="password" required autoComplete="off" placeholder="xxxx xxxx xxxx xxxx" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}
        </Field>
        <Field label="Leer correos desde" hint="Los anteriores a esta fecha no se importan.">
          {(id) => <Input id={id} type="date" required value={f.sinceDate} onChange={(e) => setF({ ...f, sinceDate: e.target.value })} />}
        </Field>
      </div>
      {advanced ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Servidor IMAP">{(id) => <Input id={id} required value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} />}</Field>
          <Field label="Puerto">{(id) => <Input id={id} type="number" required value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} />}</Field>
          <Field label="Carpeta">{(id) => <Input id={id} required value={f.mailbox} onChange={(e) => setF({ ...f, mailbox: e.target.value })} />}</Field>
        </div>
      ) : (
        <button type="button" className="self-start text-sm font-medium text-primary hover:underline" onClick={() => setAdvanced(true)}>
          Otro proveedor (Outlook, Yahoo…)
        </button>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving}>
          Conectar
        </Button>
      </div>
    </form>
  );
};

/** Mailboxes read for bank notifications; what they find goes to "Por revisar". */
export const EmailSettings = () => {
  const { canWrite } = usePrefs();
  const connections = useQuery({
    queryKey: ['email-connections'],
    queryFn: () => api.get<{ connections: EmailConnection[]; banks: string[] }>('/email-connections'),
  });
  const [adding, setAdding] = useState(false);
  const [synced, setSynced] = useState<SyncResult | null>(null);
  const create = useApiMutation((payload: unknown) => api.post<EmailConnection>('/email-connections', payload), ['email-connections']);
  const update = useApiMutation(({ id, payload }: { id: string; payload: unknown }) => api.patch(`/email-connections/${id}`, payload), ['email-connections']);
  const remove = useApiMutation((id: string) => api.del(`/email-connections/${id}`), ['email-connections']);
  const sync = useApiMutation((id: string) => api.post<SyncResult>(`/email-connections/${id}/sync`), ['email-connections', 'inbox']);

  const runSync = async (id: string) => {
    setSynced(null);
    try {
      setSynced(await sync.mutateAsync(id));
    } catch {
      // Shown by the banner and saved as the connection's last error.
    }
  };

  return (
    <Card>
      <CardHeader
        title="Correos del banco"
        subtitle={`Lee las notificaciones de consumos, retiros y transferencias de ${connections.data?.banks.join(', ') ?? 'tus bancos'} y las deja en Gastos → Por revisar. Se revisa cada 15 minutos.`}
        actions={canWrite && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Conectar correo</Button>}
      />
      <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
        <ErrorBanner error={sync.error ?? update.error ?? remove.error} />
        {synced && (
          <Notice tone="primary">
            {synced.recognized} notificaciones leídas: {synced.added} nuevas en "Por revisar"
            {synced.duplicates > 0 && `, ${synced.duplicates} ya estaban`}.
          </Notice>
        )}
        <p className="text-xs text-muted">
          Para que cada movimiento quede en su cuenta, escribe en Cuentas las terminaciones (últimos 4 dígitos) de cada cuenta y tarjeta.
        </p>
      </div>
      {connections.isLoading ? (
        <Spinner />
      ) : !connections.data?.connections.length ? (
        <EmptyState title="Sin correos conectados" description="También puedes subir correos guardados (.eml) en Gastos → Importar archivo." />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {connections.data.connections.map((c) => (
            <li key={c.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5 ${c.active ? '' : 'opacity-60'}`}>
              <Mail className="size-5 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.username} {!c.active && <Badge>Pausado</Badge>}
                </p>
                <p className="text-xs text-muted">
                  Desde {formatDate(c.sinceDate)} · {c.lastSyncedAt ? `última lectura ${formatDateTime(c.lastSyncedAt)}` : 'aún sin leer'}
                </p>
                {c.lastError && <p className="mt-1 text-xs text-danger">Error: {c.lastError}</p>}
              </div>
              {canWrite && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} loading={sync.isPending && sync.variables === c.id} onClick={() => runSync(c.id)}>
                    Leer ahora
                  </Button>
                  <IconButton
                    label={c.active ? 'Pausar' : 'Reanudar'}
                    onClick={() => update.mutate({ id: c.id, payload: { active: !c.active } })}
                    icon={c.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                  />
                  <IconButton label="Desconectar" onClick={() => confirm(`¿Desconectar ${c.username}?`) && remove.mutate(c.id)} icon={<Trash2 className="size-4" />} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Conectar correo">
        {adding && (
          <ConnectionForm
            onCancel={() => setAdding(false)}
            onSubmit={async (payload) => {
              const created = await create.mutateAsync(payload);
              setAdding(false);
              await runSync(created.id);
            }}
          />
        )}
      </Modal>
    </Card>
  );
};
