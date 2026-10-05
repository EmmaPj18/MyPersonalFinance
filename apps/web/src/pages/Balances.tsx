import { ArrowRight } from 'lucide-react';
import { Money } from '../components/finance';
import { Card, CardHeader, EmptyState, Notice, PageHeader, Spinner, Table, Td, Th } from '../components/ui';
import { usePrefs } from '../context/prefs';
import { useMemberBalances } from '../lib/queries';

export const BalancesPage = () => {
  const { currency, nameOf } = usePrefs();
  const balances = useMemberBalances(currency);

  return (
    <>
      <PageHeader
        title="Balance entre miembros"
        subtitle="Cuánto pagó cada uno de los gastos comunes frente a la parte que le corresponde (histórico, gastos pagados)."
      />
      {balances.isLoading || !balances.data ? (
        <Spinner />
      ) : balances.data.members.length === 0 ? (
        <Card>
          <EmptyState title="Aún no hay gastos comunes pagados" />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {balances.data.missingRates.length > 0 && (
            <Notice>Faltan tasas de cambio ({balances.data.missingRates.join(', ')}); algunos gastos no se incluyeron.</Notice>
          )}
          <Card>
            <Table>
              <thead>
                <tr>
                  <Th>Miembro</Th>
                  <Th className="text-right">Pagó</Th>
                  <Th className="text-right">Le corresponde</Th>
                  <Th className="text-right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                {balances.data.members.map((m) => (
                  <tr key={m.userId}>
                    <Td className="font-medium">{nameOf(m.userId)}</Td>
                    <Td className="text-right">
                      <Money value={m.paid} currency={currency} />
                    </Td>
                    <Td className="text-right">
                      <Money value={m.share} currency={currency} />
                    </Td>
                    <Td className={`text-right font-semibold ${Number(m.balance) >= 0 ? 'text-success' : 'text-danger'}`}>
                      <Money value={m.balance} currency={currency} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Para quedar a mano" />
            {balances.data.settlements.length === 0 ? (
              <EmptyState title="Están a mano" />
            ) : (
              <ul className="divide-y divide-border">
                {balances.data.settlements.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm sm:px-5">
                    <strong>{nameOf(s.fromUserId)}</strong>
                    <ArrowRight className="size-4 text-muted" aria-label="le debe a" />
                    <strong>{nameOf(s.toUserId)}</strong>
                    <Money value={s.amount} currency={currency} className="ml-auto font-semibold" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
};
