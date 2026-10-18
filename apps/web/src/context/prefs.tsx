import type { Currency } from '@mypersonalfinance/shared';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { currentMonth } from '../lib/format';
import { useHousehold, useMe } from '../lib/queries';
import type { Me, Member } from '../lib/types';

export type View = 'household' | 'me';

interface Prefs {
  me: Me;
  view: View;
  setView: (v: View) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  month: string;
  setMonth: (m: string) => void;
  members: Member[];
  /** Display name for a user id (members, ex-members or "Hogar" for null). */
  nameOf: (userId: string | null | undefined) => string;
  canWrite: boolean;
  isOwner: boolean;
  /** Personal records the user can edit: own, of members without an account, or all if owner. */
  canEditOwner: (ownerUserId: string | null) => boolean;
  /** Personal records shown in "Mis finanzas". */
  isMine: (ownerUserId: string | null) => boolean;
}

const PrefsContext = createContext<Prefs | null>(null);

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); preferences just won't persist.
  }
};

export const PrefsProvider = ({ me, children }: { me: Me; children: ReactNode }) => {
  const household = useHousehold();
  const [view, setViewState] = useState<View>(() => (read('mpf.view') as View) || 'household');
  const [currency, setCurrency] = useState<Currency>(me.defaultCurrency);
  const [month, setMonth] = useState(currentMonth());

  // Follow the profile's default currency when it changes.
  useEffect(() => setCurrency(me.defaultCurrency), [me.defaultCurrency]);

  const value = useMemo<Prefs>(() => {
    const members = household.data?.members ?? [];
    const names = new Map<string, string>([
      ...members.map((m) => [m.id, m.name] as const),
      ...(household.data?.exMembers ?? []).map((m) => [m.id, `${m.name} (ex-miembro)`] as const),
    ]);
    names.set(me.id, me.name);
    return {
      me,
      view,
      setView: (v) => {
        setViewState(v);
        write('mpf.view', v);
      },
      currency,
      setCurrency,
      month,
      setMonth,
      members,
      nameOf: (id) => (id ? (names.get(id) ?? 'Desconocido') : 'Hogar'),
      canWrite: me.role !== 'viewer',
      isOwner: me.role === 'owner',
      canEditOwner: (ownerUserId) =>
        me.role !== 'viewer' &&
        (me.role === 'owner' || !ownerUserId || ownerUserId === me.id || members.some((m) => m.id === ownerUserId && m.accountStatus === 'managed')),
      isMine: (ownerUserId) => ownerUserId === me.id,
    };
  }, [me, view, currency, month, household.data]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
};

export const usePrefs = () => {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs outside PrefsProvider');
  return ctx;
};

/** Current user, guaranteed inside the authenticated area. */
export const useSession = () => {
  const me = useMe();
  return me.data!;
};
