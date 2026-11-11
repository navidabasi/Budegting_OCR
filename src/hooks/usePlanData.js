import { useMemo } from 'react';
import { useAccounts, useAllBudgets, useGoals, useGroupsData, useSettings, useTransactions, useTrips } from '../data/hooks';

/** Everything the Plan tabs, Home and Insights compute from: all transactions, groups and trips, accounts, budgets, goals. */
export function usePlanData() {
    const { transactions, loading: txLoading } = useTransactions();
    const { trips } = useTrips();
    const { groups } = useGroupsData();
    const { accounts } = useAccounts();
    const { budgets } = useAllBudgets();
    const { goals } = useGoals();
    const { defaultCurrency } = useSettings();
    return useMemo(
        () => ({ transactions, trips, groups, accounts, budgets, goals, currency: defaultCurrency, loading: txLoading }),
        [transactions, trips, groups, accounts, budgets, goals, defaultCurrency, txLoading]
    );
}
