import { APP_NAME, CURRENCIES, type Currency } from '@mypersonalfinance/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button, ErrorBanner, Field, Input, Select } from '../components/ui';
import { api } from '../lib/api';
import { CURRENCY_LABELS } from '../lib/format';
import type { Me } from '../lib/types';

export const AuthShell = ({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) => (
  <div className="flex min-h-dvh items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-6 flex items-center justify-center gap-2">
        <img src="/favicon.svg" alt="" className="size-9" />
        <span className="text-xl font-bold tracking-tight">{APP_NAME}</span>
      </div>
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  </div>
);

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const me = await api.post<Me>('/auth/login', { email, password });
      qc.setQueryData(['me'], me);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Iniciar sesión" subtitle="Presupuesto personal y familiar">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <ErrorBanner error={error} />
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Contraseña">
          {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" loading={loading}>
          Entrar
        </Button>
        <p className="text-center text-sm text-muted">
          ¿No tienes cuenta?{' '}
          <Link to="/registro" className="font-medium text-primary hover:underline">
            Crear cuenta
          </Link>
        </p>
      </form>
    </AuthShell>
  );
};

export const RegisterPage = () => {
  const [form, setForm] = useState({ name: '', email: '', password: '', defaultCurrency: 'DOP' as Currency, householdName: '' });
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const me = await api.post<Me>('/auth/register', { ...form, householdName: form.householdName || undefined });
      qc.setQueryData(['me'], me);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Crear cuenta" subtitle="Se creará tu hogar; luego podrás invitar a tu familia.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <ErrorBanner error={error} />
        <Field label="Nombre">{(id) => <Input id={id} required autoComplete="name" value={form.name} onChange={set('name')} />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" required autoComplete="email" value={form.email} onChange={set('email')} />}</Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres">
          {(id) => <Input id={id} type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
        <Field label="Moneda por defecto">
          {(id) => (
            <Select id={id} value={form.defaultCurrency} onChange={set('defaultCurrency')}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {CURRENCY_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Nombre del hogar (opcional)">
          {(id) => <Input id={id} placeholder={form.name ? `Hogar de ${form.name}` : 'Hogar de …'} value={form.householdName} onChange={set('householdName')} />}
        </Field>
        <Button type="submit" loading={loading}>
          Crear cuenta
        </Button>
        <p className="text-center text-sm text-muted">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Inicia sesión
          </Link>
        </p>
      </form>
    </AuthShell>
  );
};
