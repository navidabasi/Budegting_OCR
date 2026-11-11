/**
 * React hooks over the data layer (TanStack Query on top of the Dexie mirror).
 *
 * Reads are queries keyed under ['data', table, userId, ...]; they read the local mirror, so they are
 * instant and work offline. Mutations write mirror + outbox (repo.js) and invalidate every data query,
 * which replaces the old window `refresh*` custom events. Sync (sync.js) invalidates after pulls.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';
import * as repo from './repo';
import { clearAndResync, getSyncState, subscribeSync, syncNow } from './sync';
import { getStorageHealth, openDb } from './db';
import { notifyDataChanged } from './queryClient';
import { getImageUrl } from './images';
import { activeTrip } from '../utils/tripMath';
import { dateKey } from '../utils/monthMath';

// Stable empty array so consumers' effects/memos do not re-run on every render while a query is pending
const EMPTY = Object.freeze([]);

const useUserId = () => useAppStore((state) => state.currentUser?.userId || null);

export function useSyncStatus() {
    return useSyncExternalStore(subscribeSync, getSyncState, getSyncState);
}

/** True while the mirror is empty and the first sync has not finished (avoids an "empty" flash). */
function useInitialLoading(query, isEmpty) {
    const sync = useSyncStatus();
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return query.isLoading || (isEmpty && !sync.attempted && !offline);
}

const dataQuery = (table, userId, extra, fn, enabled = true) => ({
    queryKey: ['data', table, userId, ...extra],
    queryFn: fn,
    enabled: !!userId && enabled,
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/** `month` is 'YYYY-MM'; omit for all transactions. */
export function useTransactions({ month } = {}) {
    const userId = useUserId();
    const query = useQuery(dataQuery('transactions', userId, [month || 'all'], () => repo.listTransactions(userId, { month })));
    const transactions = query.data || EMPTY;
    const initialLoading = useInitialLoading(query, transactions.length === 0);
    const loading = !!userId && initialLoading;
    return { transactions, loading, error: query.error, reload: () => notifyDataChanged() };
}

export function useTransaction(id) {
    const userId = useUserId();
    return useQuery(dataQuery('transactions', userId, ['one', id], () => repo.getTransaction(id), !!id));
}

function useDataMutation(fn) {
    const m = useMutation({ mutationFn: (args) => fn(...args), onSuccess: () => notifyDataChanged() });
    return useCallback((...args) => m.mutateAsync(args), [m.mutateAsync]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const useCreateTransaction = () => useDataMutation(repo.createTransaction);
export const useUpdateTransaction = () => useDataMutation(repo.updateTransaction);
export const useDeleteTransaction = () => useDataMutation(repo.deleteTransaction);
export const useMarkTransactionDone = () => useDataMutation(repo.markTransactionDone);

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export function useGroupsData() {
    const userId = useUserId();
    const query = useQuery(dataQuery('groups', userId, [], () => repo.listGroups(userId)));
    const groups = query.data || EMPTY;
    const initialLoading = useInitialLoading(query, groups.length === 0);
    const loading = !!userId && initialLoading;
    return { groups, loading, error: query.error, reload: () => notifyDataChanged() };
}

/** Resolves to the created group record. */
export function useCreateGroup() {
    const userId = useUserId();
    const create = useDataMutation(repo.createGroup);
    return useCallback((data) => create(userId, data), [create, userId]);
}
export const useUpdateGroup = () => useDataMutation(repo.updateGroup);
export const useDeleteGroup = () => useDataMutation(repo.deleteGroup);

// ---------------------------------------------------------------------------
// Categories (custom categories; hooks/useCategories merges the defaults)
// ---------------------------------------------------------------------------

export function useUserCategories() {
    const userId = useUserId();
    const query = useQuery(dataQuery('categories', userId, [], () => repo.listCategories(userId)));
    return { categories: query.data || EMPTY, loading: query.isLoading, error: query.error, reload: () => notifyDataChanged() };
}

export function useCreateCategory() {
    const userId = useUserId();
    const create = useDataMutation(repo.createCategory);
    return useCallback((data) => create(userId, data), [create, userId]);
}
export const useUpdateCategory = () => useDataMutation(repo.updateCategory);
export const useDeleteCategory = () => useDataMutation(repo.deleteCategory);

// ---------------------------------------------------------------------------
// Settings (OCR key, currency, language, notification preferences) and dashboard layout
// ---------------------------------------------------------------------------

export function useSettings() {
    const userId = useUserId();
    const query = useQuery(dataQuery('settings', userId, [], () => repo.getSettings(userId)));
    return {
        settings: query.data || null,
        loading: query.isLoading,
        isSuccess: query.isSuccess,
        defaultCurrency: query.data?.defaultCurrency || 'EUR',
    };
}

/** save(patch) merges the patch into the stored settings. */
export function useSaveSettings() {
    const userId = useUserId();
    const save = useDataMutation(repo.saveSettings);
    return useCallback((patch) => save(userId, patch), [save, userId]);
}

export function useLayoutData() {
    const userId = useUserId();
    const query = useQuery(dataQuery('layouts', userId, [], () => repo.getLayout(userId)));
    return { layoutRecord: query.data || null, loading: query.isLoading, reload: () => notifyDataChanged() };
}

export function useSaveLayout() {
    const userId = useUserId();
    const save = useDataMutation(repo.saveLayout);
    return useCallback((layout) => save(userId, layout), [save, userId]);
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

export function useDemoData() {
    const userId = useUserId();
    const { transactions } = useTransactions();
    const seed = useDataMutation(repo.seedDemoData);
    const clear = useDataMutation(repo.clearDemoData);
    return useMemo(
        () => ({
            demoCount: transactions.filter((r) => r.isDemo).length,
            seedDemoData: () => seed(userId),
            clearDemoData: () => clear(userId),
        }),
        [transactions, seed, clear, userId]
    );
}

// ---------------------------------------------------------------------------
// Sync actions
// ---------------------------------------------------------------------------

export function useSyncActions() {
    const userId = useUserId();
    return useMemo(
        () => ({
            syncNow: (opts) => syncNow(userId, { reason: 'manual', ...opts }),
            clearAndResync: () => clearAndResync(userId),
        }),
        [userId]
    );
}

/** Local cache health for the "cache unavailable" banner. */
export async function checkStorageHealth(force = false) {
    await openDb({ force });
    return getStorageHealth();
}

// ---------------------------------------------------------------------------
// Plan-phase tables (accounts, budgets, goals, rules): read hooks + generic mutations
// ---------------------------------------------------------------------------

function useRows(table, filter, extraKey = []) {
    const userId = useUserId();
    const query = useQuery(dataQuery(table, userId, extraKey, () => repo.listRows(table, userId, filter)));
    return { rows: query.data || EMPTY, loading: query.isLoading };
}

export function useAccounts() {
    const { rows, loading } = useRows('accounts', (a) => !a.isArchived);
    return { accounts: [...rows].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)), loading };
}

/** Budgets that apply to `month` ('YYYY-MM'): started on/before it and not ended before it. */
export function useBudgets(month) {
    const first = month ? `${month}-01` : null;
    const { rows, loading } = useRows(
        'budgets',
        first ? (b) => b.startsOn <= first && (!b.endsOn || b.endsOn >= first) : undefined,
        [month || 'all']
    );
    return { budgets: rows, loading };
}

export function useGoals() {
    const { rows, loading } = useRows('goals', (g) => !g.isArchived);
    return { goals: rows, loading };
}

export function useRules() {
    const { rows, loading } = useRows('rules');
    return { rules: rows, loading };
}

/** The user's merchant rules ({ merchantKey, category, displayName, source, hitCount }) for suggestCategory / suggestForMerchant. */
export function useMerchantRules() {
    const { rules, loading } = useRules();
    return { rules, loading };
}

/** All budget rows of the user (every month); budgetMath.activeBudgets picks the ones that apply to a month. */
export function useAllBudgets() {
    return useBudgets();
}

// ---------------------------------------------------------------------------
// Trips: groups with kind = 'trip'
// ---------------------------------------------------------------------------

export function useTrips() {
    const { groups, loading } = useGroupsData();
    const trips = useMemo(() => groups.filter((g) => g.kind === 'trip'), [groups]);
    return { trips, loading };
}

/** { trip, trips, loading }: the trip new transactions join (manual start or today inside its dates), or null. */
export function useActiveTrip() {
    const { trips, loading } = useTrips();
    const today = dateKey(new Date());
    const trip = useMemo(() => activeTrip(trips, today), [trips, today]);
    return { trip, trips, loading };
}

/** create(data) -> the new trip record. Defaults: kept out of category budgets, started now when it has no end date. */
export function useCreateTrip() {
    const create = useCreateGroup();
    return useCallback(
        (data) => {
            const today = dateKey(new Date());
            return create({
                color: '#1F4E79',
                isPinned: false,
                excludeFromBudgets: true,
                ...data,
                kind: 'trip',
                isActive: data.isActive ?? (!!data.startsOn && data.startsOn <= today && !data.endsOn),
            });
        },
        [create]
    );
}

/** create(data) / update(id, patch) / remove(id) for one of: accounts, budgets, goals, rules. */
export function useRowMutations(table) {
    const userId = useUserId();
    const create = useDataMutation((data) => repo.createRow(table, userId, data));
    const update = useDataMutation((id, patch) => repo.updateRow(table, id, patch));
    const remove = useDataMutation((id) => repo.deleteRow(table, id));
    return useMemo(() => ({ create, update, remove }), [create, update, remove]);
}

// ---------------------------------------------------------------------------
// Receipt images
// ---------------------------------------------------------------------------

/** { url, loading, local } for a transaction's receipt image (local blob while queued, else signed URL). */
export function useReceiptImage(transaction) {
    const id = transaction?.id;
    const path = transaction?.imagePath;
    const [state, setState] = useState({ url: null, loading: !!path, local: false });
    useEffect(() => {
        if (!id || !path) {
            setState({ url: null, loading: false, local: false });
            return undefined;
        }
        let cancelled = false;
        let handle = null;
        setState((s) => ({ ...s, loading: true }));
        getImageUrl({ transactionId: id, imagePath: path }).then((h) => {
            handle = h;
            if (cancelled) h.revoke();
            else setState({ url: h.url, loading: false, local: h.local });
        });
        return () => {
            cancelled = true;
            handle?.revoke();
        };
    }, [id, path]);
    return state;
}
