import { useEffect, useRef } from 'react';
import { useBudgets, useRowMutations, useSyncStatus } from '../data/hooks';
import { copyForward } from '../utils/budgetMath';
import { monthKey } from '../utils/monthMath';

/**
 * On the first visit of a new month, every active budget gets its own row starting that month (so editing this
 * month never rewrites history). Runs once per month per session, after the first sync so another device's rows
 * are seen first.
 */
export function useCopyForwardBudgets() {
    const { budgets, loading } = useBudgets();
    const sync = useSyncStatus();
    const { create } = useRowMutations('budgets');
    const done = useRef(new Set());
    useEffect(() => {
        if (loading) return;
        if (!sync.attempted && typeof navigator !== 'undefined' && navigator.onLine) return;
        const month = monthKey(new Date());
        if (done.current.has(month)) return;
        const rows = copyForward(budgets, month);
        done.current.add(month);
        rows.forEach((row) => create(row).catch((err) => console.warn('[Budgets] copy forward failed:', err)));
    }, [budgets, loading, sync.attempted, create]);
}
