import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addMonths, monthKey } from '../utils/monthMath';

const RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The month every month-scoped screen shows, kept in the URL as `?m=YYYY-MM` (the current month is the default and
 * is left out of the URL). Shared by Home, Plan (Budgets/Savings) and linked from insights.
 *   { month, isCurrent, setMonth(m), shift(n), prev(), next(), current }
 */
export function useSelectedMonth(now = new Date()) {
    const [params, setParams] = useSearchParams();
    const current = monthKey(now);
    const raw = params.get('m') || '';
    const month = RE.test(raw) ? raw : current;

    const setMonth = useCallback(
        (m) => {
            setParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
                    if (!RE.test(m) || m === current) next.delete('m');
                    else next.set('m', m);
                    return next;
                },
                { replace: true }
            );
        },
        [setParams, current]
    );
    const shift = useCallback((n) => setMonth(addMonths(month, n)), [setMonth, month]);

    return useMemo(
        () => ({ month, current, isCurrent: month === current, setMonth, shift, prev: () => shift(-1), next: () => shift(1) }),
        [month, current, setMonth, shift]
    );
}
