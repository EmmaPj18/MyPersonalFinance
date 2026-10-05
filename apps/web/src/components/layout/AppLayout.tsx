import { APP_NAME, CURRENCIES, type Currency } from '@mypersonalfinance/shared';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  PiggyBank,
  Receipt,
  Settings,
  Target,
  Wallet,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { usePrefs, type View } from '../../context/prefs';
import { api } from '../../lib/api';
import { formatMonth, shiftMonth } from '../../lib/format';
import { IconButton, Segmented, Select } from '../ui';

const NAV = [
  { to: '/', label: 'Resumen', icon: LayoutDashboard, end: true },
  { to: '/ingresos', label: 'Ingresos', icon: Wallet },
  { to: '/gastos', label: 'Gastos', icon: Receipt },
  { to: '/presupuesto', label: 'Presupuesto', icon: PiggyBank },
  { to: '/balance', label: 'Balance entre miembros', icon: ArrowLeftRight },
  { to: '/metas', label: 'Metas de ahorro', icon: Target },
  { to: '/deudas', label: 'Deudas', icon: HandCoins },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
];

export const MonthPicker = () => {
  const { month, setMonth } = usePrefs();
  return (
    <div className="flex items-center gap-1">
      <IconButton label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))} icon={<ChevronLeft className="size-4" />} />
      <label className="sr-only" htmlFor="month-picker">
        Mes
      </label>
      <input
        id="month-picker"
        type="month"
        value={month}
        onChange={(e) => e.target.value && setMonth(e.target.value)}
        className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
        title={formatMonth(month)}
      />
      <IconButton label="Mes siguiente" onClick={() => setMonth(shiftMonth(month, 1))} icon={<ChevronRight className="size-4" />} />
    </div>
  );
};

export const AppLayout = () => {
  const { me, view, setView, currency, setCurrency } = usePrefs();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    navigate('/login');
  };

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Principal">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-text',
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2 px-3">
      <img src="/favicon.svg" alt="" className="size-7" />
      <span className="font-bold tracking-tight">{APP_NAME}</span>
    </div>
  );

  const userBox = (
    <div className="border-t border-border px-3 pt-3">
      <p className="truncate text-sm font-medium">{me.name}</p>
      <p className="truncate text-xs text-muted">{me.household.name}</p>
      <button type="button" onClick={logout} className="mt-2 inline-flex items-center gap-2 text-sm text-muted hover:text-text">
        <LogOut className="size-4" aria-hidden /> Cerrar sesión
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col justify-between border-r border-border bg-surface py-4 lg:flex">
        <div className="flex flex-col gap-6 px-2">
          {brand}
          {nav}
        </div>
        {userBox}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col justify-between bg-surface py-4">
            <div className="flex flex-col gap-6 px-2">
              <div className="flex items-center justify-between pr-2">
                {brand}
                <IconButton label="Cerrar menú" onClick={() => setOpen(false)} icon={<X className="size-4" />} />
              </div>
              {nav}
            </div>
            {userBox}
          </aside>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-surface/90 px-4 py-2 backdrop-blur sm:px-6">
          <IconButton className="lg:hidden" label="Abrir menú" onClick={() => setOpen(true)} icon={<Menu className="size-5" />} />
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <Segmented<View>
              ariaLabel="Vista"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'household', label: 'Hogar' },
                { value: 'me', label: 'Mis finanzas' },
              ]}
            />
            <label className="sr-only" htmlFor="display-currency">
              Moneda de visualización
            </label>
            <Select
              id="display-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="!h-8 !w-auto text-xs"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
