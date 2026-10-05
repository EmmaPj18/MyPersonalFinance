import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Currency } from '@mypersonalfinance/shared';
import { api, ApiError } from './api';
import type {
  Account,
  AuditEntry,
  BudgetView,
  Category,
  Debt,
  DeductionType,
  Expense,
  FxRate,
  Goal,
  Household,
  IncomeEntry,
  IncomeSource,
  Invitation,
  LeavePreview,
  Me,
  MemberBalances,
  MonthlyReport,
  RecurringExpense,
  YearlyReport,
} from './types';

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });

export const useHousehold = () => useQuery({ queryKey: ['household'], queryFn: () => api.get<Household>('/household') });
export const useInvitations = (enabled: boolean) =>
  useQuery({ queryKey: ['invitations'], queryFn: () => api.get<Invitation[]>('/household/invitations'), enabled });
export const useLeavePreview = (enabled: boolean) =>
  useQuery({ queryKey: ['leave-preview'], queryFn: () => api.get<LeavePreview>('/household/leave-preview'), enabled });

export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/accounts') });
export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });
export const useDeductionTypes = () =>
  useQuery({ queryKey: ['deduction-types'], queryFn: () => api.get<DeductionType[]>('/deduction-types') });
export const useFxRates = () => useQuery({ queryKey: ['fx-rates'], queryFn: () => api.get<FxRate[]>('/fx-rates') });

export const useIncomeSources = () =>
  useQuery({ queryKey: ['income-sources'], queryFn: () => api.get<IncomeSource[]>('/income-sources') });
export const useIncomeEntries = (filters: Record<string, string | undefined>) =>
  useQuery({ queryKey: ['income-entries', filters], queryFn: () => api.get<IncomeEntry[]>('/income-entries', filters) });

export const useExpenses = (filters: Record<string, string | undefined>) =>
  useQuery({ queryKey: ['expenses', filters], queryFn: () => api.get<Expense[]>('/expenses', filters) });
export const useExpenseHistory = (id: string | null) =>
  useQuery({
    queryKey: ['expense-history', id],
    queryFn: () => api.get<AuditEntry[]>(`/expenses/${id}/history`),
    enabled: Boolean(id),
  });
export const useRecurringExpenses = () =>
  useQuery({ queryKey: ['recurring-expenses'], queryFn: () => api.get<RecurringExpense[]>('/recurring-expenses') });

export const useBudget = (month: string) =>
  useQuery({ queryKey: ['budget', month], queryFn: () => api.get<BudgetView>(`/budgets/${month}`) });

export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: () => api.get<Goal[]>('/goals') });
export const useDebts = () => useQuery({ queryKey: ['debts'], queryFn: () => api.get<Debt[]>('/debts') });

export const useMonthlyReport = (month: string, currency: Currency, view: 'household' | 'me') =>
  useQuery({
    queryKey: ['report', 'monthly', month, currency, view],
    queryFn: () => api.get<MonthlyReport>('/reports/monthly', { month, currency, view }),
  });
export const useYearlyReport = (year: number, currency: Currency, view: 'household' | 'me') =>
  useQuery({
    queryKey: ['report', 'yearly', year, currency, view],
    queryFn: () => api.get<YearlyReport>('/reports/yearly', { year, currency, view }),
  });
export const useMemberBalances = (currency: Currency) =>
  useQuery({
    queryKey: ['report', 'balances', currency],
    queryFn: () => api.get<MemberBalances>('/reports/member-balances', { currency }),
  });

/**
 * Mutation that invalidates the given query roots on success. Most writes affect reports
 * and budgets too, so those are always refreshed.
 */
export const useApiMutation = <TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidate: string[] = [],
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(
        [...invalidate, 'report', 'budget', 'accounts'].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
};
