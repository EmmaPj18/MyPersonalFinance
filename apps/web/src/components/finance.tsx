import { CURRENCIES, type Currency, type Scope } from '@mypersonalfinance/shared';
import clsx from 'clsx';
import { Home, User } from 'lucide-react';
import { usePrefs } from '../context/prefs';
import { formatMoney } from '../lib/format';
import { useAccounts, useCategories } from '../lib/queries';
import type { Split } from '../lib/types';
import { Badge, Checkbox, Input, Select } from './ui';

export const CurrencySelect = ({ id, value, onChange }: { id?: string; value: Currency; onChange: (c: Currency) => void }) => (
  <Select id={id} value={value} onChange={(e) => onChange(e.target.value as Currency)}>
    {CURRENCIES.map((c) => (
      <option key={c} value={c}>
        {c}
      </option>
    ))}
  </Select>
);

export const CategorySelect = ({
  id,
  value,
  onChange,
  ariaLabel,
}: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  ariaLabel?: string;
}) => {
  const categories = useCategories();
  return (
    <Select id={id} aria-label={ariaLabel} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Sin categoría</option>
      {(categories.data ?? [])
        .filter((c) => !c.archived || c.id === value)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
    </Select>
  );
};

export const AccountSelect = ({ id, value, onChange }: { id?: string; value: string | null; onChange: (id: string | null) => void }) => {
  const accounts = useAccounts();
  const { nameOf } = usePrefs();
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Sin cuenta</option>
      {(accounts.data ?? [])
        .filter((a) => !a.archived || a.id === value)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {a.currency} · {nameOf(a.ownerUserId)}
          </option>
        ))}
    </Select>
  );
};

export interface Ownership {
  scope: Scope;
  ownerUserId: string | null;
}

/** "Hogar (común)" or a specific member. */
export const OwnerSelect = ({
  id,
  value,
  onChange,
  sharedLabel = 'Hogar (común)',
  ariaLabel,
}: {
  id?: string;
  value: Ownership;
  onChange: (v: Ownership) => void;
  sharedLabel?: string;
  ariaLabel?: string;
}) => {
  const { members } = usePrefs();
  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={value.scope === 'shared' ? 'shared' : (value.ownerUserId ?? '')}
      onChange={(e) =>
        onChange(e.target.value === 'shared' ? { scope: 'shared', ownerUserId: null } : { scope: 'personal', ownerUserId: e.target.value })
      }
    >
      <option value="shared">{sharedLabel}</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} (personal{m.accountStatus === 'managed' ? ', sin cuenta' : ''})
        </option>
      ))}
    </Select>
  );
};

/** Owner select for records without scope column (accounts, goals, debts): null = shared. */
export const NullableOwnerSelect = ({ id, value, onChange }: { id?: string; value: string | null; onChange: (v: string | null) => void }) => (
  <OwnerSelect
    id={id}
    value={{ scope: value ? 'personal' : 'shared', ownerUserId: value }}
    onChange={(v) => onChange(v.ownerUserId)}
  />
);

export const OwnerBadge = ({ scope, ownerUserId }: Ownership) => {
  const { nameOf } = usePrefs();
  return scope === 'shared' || !ownerUserId ? (
    <Badge tone="primary">
      <Home className="size-3" aria-hidden /> Hogar
    </Badge>
  ) : (
    <Badge>
      <User className="size-3" aria-hidden /> {nameOf(ownerUserId)}
    </Badge>
  );
};

export interface SplitState {
  custom: boolean;
  shares: Record<string, string>;
}

/** `custom` says whether the stored split was chosen by hand (otherwise it's the default split). */
export const splitStateFrom = (splits: Split[] | undefined, custom = Boolean(splits?.length)): SplitState => ({
  custom: custom && Boolean(splits?.length),
  shares: Object.fromEntries((splits ?? []).map((s) => [s.userId, String(Number(s.sharePct))])),
});

export const splitTotal = (state: SplitState) => Object.values(state.shares).reduce((acc, v) => acc + (Number(v) || 0), 0);

/** Splits to send to the API (empty = follow the members' default split). */
export const splitsPayload = (state: SplitState) =>
  state.custom
    ? Object.entries(state.shares)
        .filter(([, v]) => Number(v) > 0)
        .map(([userId, v]) => ({ userId, sharePct: Number(v) }))
    : [];

export const SplitEditor = ({
  value,
  onChange,
  amount,
  currency,
}: {
  value: SplitState;
  onChange: (v: SplitState) => void;
  amount?: string;
  currency?: Currency;
}) => {
  const { members } = usePrefs();
  const total = splitTotal(value);
  const enable = (custom: boolean) => {
    if (!custom) return onChange({ custom, shares: {} });
    const even = Math.floor((100 / members.length) * 100) / 100;
    onChange({
      custom,
      shares: Object.fromEntries(
        members.map((m, i) => [m.id, String(i === members.length - 1 ? +(100 - even * (members.length - 1)).toFixed(2) : even)]),
      ),
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <Checkbox label="Reparto personalizado" checked={value.custom} onChange={(e) => enable(e.target.checked)} />
      {!value.custom && <p className="text-xs text-muted">Se usa el reparto por defecto del hogar (configurable en Configuración → Hogar).</p>}
      {value.custom && (
        <>
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <span className="flex-1 truncate text-sm">{m.name}</span>
              <div className="flex w-28 items-center gap-1">
                <Input
                  aria-label={`Porcentaje de ${m.name}`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  className="tabular !h-8 text-right"
                  value={value.shares[m.id] ?? ''}
                  onChange={(e) => onChange({ ...value, shares: { ...value.shares, [m.id]: e.target.value } })}
                />
                <span className="text-sm text-muted">%</span>
              </div>
              {amount && currency && (
                <span className="tabular w-28 text-right text-xs text-muted">
                  {formatMoney((Number(amount) * (Number(value.shares[m.id]) || 0)) / 100, currency)}
                </span>
              )}
            </div>
          ))}
          <p className={clsx('text-xs', Math.abs(total - 100) < 0.001 ? 'text-success' : 'text-danger')}>
            Total: {total.toFixed(2)}% {Math.abs(total - 100) < 0.001 ? '' : '(debe sumar 100%)'}
          </p>
        </>
      )}
    </div>
  );
};

export const Money = ({ value, currency, className }: { value: string | number; currency: Currency; className?: string }) => (
  <span className={clsx('tabular whitespace-nowrap', className)}>{formatMoney(value, currency)}</span>
);
