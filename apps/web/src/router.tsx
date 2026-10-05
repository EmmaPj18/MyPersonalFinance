import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { Spinner } from './components/ui';
import { PrefsProvider } from './context/prefs';
import { useMe } from './lib/queries';
import { AcceptInvitationPage } from './pages/AcceptInvitation';
import { LoginPage, RegisterPage } from './pages/Auth';

const RequireAuth = () => {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading) return <Spinner />;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <PrefsProvider me={me.data}>
      <Outlet />
    </PrefsProvider>
  );
};

const GuestOnly = () => {
  const me = useMe();
  if (me.isLoading) return <Spinner />;
  return me.data ? <Navigate to="/" replace /> : <Outlet />;
};

/** Route-level code splitting: each page loads on demand. */
const page = (load: () => Promise<Record<string, React.ComponentType>>, name: string) => async () => ({
  Component: (await load())[name],
});

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/registro', element: <RegisterPage /> },
    ],
  },
  { path: '/invitations/:token', element: <AcceptInvitationPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, lazy: page(() => import('./pages/Dashboard'), 'DashboardPage') },
          { path: 'ingresos', lazy: page(() => import('./pages/Income'), 'IncomePage') },
          { path: 'gastos', lazy: page(() => import('./pages/Expenses'), 'ExpensesPage') },
          { path: 'presupuesto', lazy: page(() => import('./pages/Budget'), 'BudgetPage') },
          { path: 'balance', lazy: page(() => import('./pages/Balances'), 'BalancesPage') },
          { path: 'metas', lazy: page(() => import('./pages/Goals'), 'GoalsPage') },
          { path: 'deudas', lazy: page(() => import('./pages/Debts'), 'DebtsPage') },
          { path: 'configuracion', lazy: page(() => import('./pages/settings/Settings'), 'SettingsPage') },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
