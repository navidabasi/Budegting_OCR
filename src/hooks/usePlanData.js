import { useMemo } from 'react';
import { useAccounts, useAllBudgets, useGoals, useSettings, useTransactions, useTrips } from '../data/hooks';

/** Everything the Plan tabs, Home and Insights compute from: all transactions, trips, accounts, budgets, goals. */
export function usePlanData() {
    const { transactions, loading: txLoading } = useTransactions();
    const { trips } = useTrips();
    const { accounts } = useAccounts();
    const { budgets } = useAllBudgets();
    const { goals } = useGoals();
    const { defaultCurrency } = useSettings();
    return useMemo(
        () => ({ transactions, trips, accounts, budgets, goals, currency: defaultCurrency, loading: txLoading }),
        [transactions, trips, accounts, budgets, goals, defaultCurrency, txLoading]
    );
}
