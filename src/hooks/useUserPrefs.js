import { useCallback, useMemo } from 'react';
import { useLayoutData, useSaveLayout } from '../data/hooks';

/**
 * Small per-user preferences kept in the synced `user_layouts.layout` JSON (the dashboard widget layout it used to hold is gone):
 *   { savingsTarget: number | null }
 * No schema change needed; the row is already synced by the data layer.
 */
export function useUserPrefs() {
    const { layoutRecord, loading } = useLayoutData();
    const save = useSaveLayout();
    const layout = layoutRecord?.layout || null;
    const prefs = useMemo(() => (layout && typeof layout.prefs === 'object' && layout.prefs) || {}, [layout]);
    const setPrefs = useCallback((patch) => save({ ...(layout || {}), prefs: { ...prefs, ...patch } }), [save, layout, prefs]);
    return { prefs, setPrefs, loading };
}
