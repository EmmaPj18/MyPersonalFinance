import { useState } from 'react';
import { PageHeader, Segmented } from '../../components/ui';
import { AccountsSettings } from './Accounts';
import { CatalogSettings } from './Catalogs';
import { FxRatesSettings } from './FxRates';
import { HouseholdSettings } from './Household';
import { ProfileSettings } from './Profile';

type Tab = 'profile' | 'household' | 'accounts' | 'catalogs' | 'fx';

export const SettingsPage = () => {
  const [tab, setTab] = useState<Tab>('profile');
  return (
    <>
      <PageHeader title="Configuración" />
      <div className="mb-6 overflow-x-auto">
        <Segmented<Tab>
          ariaLabel="Sección"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'profile', label: 'Perfil' },
            { value: 'household', label: 'Hogar' },
            { value: 'accounts', label: 'Cuentas' },
            { value: 'catalogs', label: 'Categorías y descuentos' },
            { value: 'fx', label: 'Tasas de cambio' },
          ]}
        />
      </div>
      {tab === 'profile' && <ProfileSettings />}
      {tab === 'household' && <HouseholdSettings />}
      {tab === 'accounts' && <AccountsSettings />}
      {tab === 'catalogs' && <CatalogSettings />}
      {tab === 'fx' && <FxRatesSettings />}
    </>
  );
};
