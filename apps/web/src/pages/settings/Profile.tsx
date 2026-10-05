import type { Currency } from '@mypersonalfinance/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { CurrencySelect } from '../../components/finance';
import { Button, Card, CardHeader, ErrorBanner, Field, Input, Notice } from '../../components/ui';
import { usePrefs } from '../../context/prefs';
import { api } from '../../lib/api';
import type { Me } from '../../lib/types';

export const ProfileSettings = () => {
  const { me } = usePrefs();
  const qc = useQueryClient();
  const [name, setName] = useState(me.name);
  const [currency, setCurrency] = useState<Currency>(me.defaultCurrency);
  const [profileState, setProfileState] = useState<{ saving: boolean; error: unknown; saved: boolean }>({ saving: false, error: null, saved: false });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwState, setPwState] = useState<{ saving: boolean; error: unknown; saved: boolean }>({ saving: false, error: null, saved: false });

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileState({ saving: true, error: null, saved: false });
    try {
      const updated = await api.patch<Me>('/me', { name, defaultCurrency: currency });
      qc.setQueryData(['me'], updated);
      await qc.invalidateQueries({ queryKey: ['household'] });
      setProfileState({ saving: false, error: null, saved: true });
    } catch (error) {
      setProfileState({ saving: false, error, saved: false });
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwState({ saving: true, error: null, saved: false });
    try {
      await api.post('/me/password', pw);
      setPw({ currentPassword: '', newPassword: '' });
      setPwState({ saving: false, error: null, saved: true });
    } catch (error) {
      setPwState({ saving: false, error, saved: false });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Perfil" subtitle={me.email} />
        <form onSubmit={saveProfile} className="flex flex-col gap-4 p-4 sm:p-5">
          <ErrorBanner error={profileState.error} />
          {profileState.saved && <Notice tone="primary">Perfil actualizado.</Notice>}
          <Field label="Nombre">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Moneda por defecto" hint="Se preselecciona en los formularios y se usa para los reportes.">
            {(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}
          </Field>
          <div>
            <Button type="submit" loading={profileState.saving}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <CardHeader title="Cambiar contraseña" subtitle="Se cerrará la sesión en tus otros dispositivos." />
        <form onSubmit={savePassword} className="flex flex-col gap-4 p-4 sm:p-5">
          <ErrorBanner error={pwState.error} />
          {pwState.saved && <Notice tone="primary">Contraseña actualizada.</Notice>}
          <Field label="Contraseña actual">
            {(id) => <Input id={id} type="password" required autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}
          </Field>
          <Field label="Nueva contraseña" hint="Mínimo 8 caracteres">
            {(id) => (
              <Input id={id} type="password" required minLength={8} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            )}
          </Field>
          <div>
            <Button type="submit" loading={pwState.saving}>
              Cambiar contraseña
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
