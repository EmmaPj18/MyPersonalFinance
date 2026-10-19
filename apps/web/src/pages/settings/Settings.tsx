import { useState } from 'react';
import { PageHeader, Segmented } from '../../components/ui';
import { AccountsSettings } from './Accounts';
import { CatalogSettings } from './Catalogs';
import { EmailSettings } from './EmailConnections';
import { FxRatesSettings } from './FxRates';
import { HouseholdSettings } from './Household';
import { ProfileSettings } from './Profile';
import { RulesSettings } from './Rules';
import { TransfersSettings } from './Transfers';

type Tab = 'profile' | 'household' | 'accounts' | 'email' | 'catalogs' | 'fx';

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
            { value: 'email', label: 'Correo' },
            { value: 'catalogs', label: 'Categorías y descuentos' },
            { value: 'fx', label: 'Tasas de cambio' },
          ]}
        />
      </div>
      {tab === 'profile' && <ProfileSettings />}
      {tab === 'household' && <HouseholdSettings />}
      {tab === 'accounts' && (
        <div className="flex flex-col gap-6">
          <AccountsSettings />
          <TransfersSettings />
        </div>
      )}
      {tab === 'email' && <EmailSettings />}
      {tab === 'catalogs' && (
        <div className="flex flex-col gap-6">
          <CatalogSettings />
          <RulesSettings />
        </div>
      )}
      {tab === 'fx' && <FxRatesSettings />}
    </>
  );
};
