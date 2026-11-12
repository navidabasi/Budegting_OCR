import { useCallback, useMemo } from 'react';
import { useUserPrefs } from './useUserPrefs';
import { pruneDismissed } from '../services/savingsOpportunities';

/**
 * Suggestions the owner marked "Not useful": { [opportunity key]: 'YYYY-MM-DD' } in the synced prefs (`layout.prefs.insightsDismissed`,
 * no schema change). A dismissed suggestion stays hidden for 60 days on every device and is sent to the model as dismissed.
 */
export function useDismissedOpportunities(today) {
    const { prefs, setPrefs, loading } = useUserPrefs();
    const dismissed = useMemo(() => (prefs.insightsDismissed && typeof prefs.insightsDismissed === 'object' ? prefs.insightsDismissed : {}), [prefs.insightsDismissed]);
    const dismiss = useCallback((key) => setPrefs({ insightsDismissed: { ...pruneDismissed(dismissed, today), [key]: today } }), [setPrefs, dismissed, today]);
    const restore = useCallback(
        (keys) => {
            const next = { ...dismissed };
            for (const k of keys || Object.keys(next)) delete next[k];
            return setPrefs({ insightsDismissed: next });
        },
        [setPrefs, dismissed]
    );
    return { dismissed, dismiss, restore, loading };
}
