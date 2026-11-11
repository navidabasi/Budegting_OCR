import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNarrative } from '../services/insightsApi';
import { getAccessToken } from '../services/accessToken';
import { hashAggregates } from '../services/insightsAggregates';

const useOnline = () => {
    const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => {
            window.removeEventListener('online', on);
            window.removeEventListener('offline', off);
        };
    }, []);
    return online;
};

const storeKey = (aggregates, language) => `wmw.narrative:${aggregates?.period?.start || ''}..${aggregates?.period?.end || ''}:${language}`;
const readStored = (key) => {
    try {
        const v = JSON.parse(localStorage.getItem(key) || 'null');
        return v && v.data && typeof v.hash === 'string' ? v : null;
    } catch {
        return null;
    }
};
const writeStored = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* the summary just is not remembered */
    }
};

/**
 * The AI narrative for a period. It is requested once, when none exists for the period yet; after that the saved summary is shown
 * with the hash of the data it was written from. When the data changes the summary is labelled out of date (`stale`) and the owner
 * decides whether to update it: nothing calls the AI per render or per data change. refresh() asks for a new one.
 * status: idle | loading | ready | offline | notConfigured | rateLimit | error.
 */
export function useInsightsNarrative({ aggregates, language, enabled = true, fetchImpl }) {
    const online = useOnline();
    const [state, setState] = useState({ status: 'idle', data: null, sourceHash: null });
    const lastKey = useRef(null);
    const hash = aggregates ? hashAggregates(aggregates) : null;
    const key = storeKey(aggregates, language);
    const aggRef = useRef(aggregates);
    aggRef.current = aggregates;

    const run = useCallback(
        async (refresh) => {
            if (!aggRef.current) return;
            const sourceHash = hashAggregates(aggRef.current);
            const at = storeKey(aggRef.current, language);
            setState((s) => ({ status: 'loading', data: s.data, sourceHash: s.sourceHash }));
            try {
                const data = await fetchNarrative({ aggregates: aggRef.current, language, refresh, getToken: getAccessToken, fetchImpl });
                writeStored(at, { data, hash: sourceHash });
                setState({ status: 'ready', data, sourceHash });
            } catch (err) {
                const kind = err?.kind;
                const status = kind === 'offline' ? 'offline' : kind === 'notConfigured' ? 'notConfigured' : kind === 'rateLimit' ? 'rateLimit' : 'error';
                setState((s) => ({ status, data: s.data, sourceHash: s.sourceHash }));
            }
        },
        [language, fetchImpl]
    );

    useEffect(() => {
        if (!enabled || !hash) return;
        const stored = readStored(key);
        if (stored) {
            // a summary for this period exists: show it (older ones are labelled stale) and make no request
            lastKey.current = key;
            setState({ status: 'ready', data: stored.data, sourceHash: stored.hash });
            return;
        }
        if (!online) {
            setState((s) => (s.status === 'ready' ? s : { status: 'offline', data: s.data, sourceHash: s.sourceHash }));
            return;
        }
        if (lastKey.current === key) return;
        lastKey.current = key;
        run(false);
    }, [enabled, hash, key, online, run]);

    const stale = state.status === 'ready' && !!hash && !!state.sourceHash && state.sourceHash !== hash;
    return { ...state, stale, online, refresh: () => run(true), retry: () => { lastKey.current = null; return run(false); } };
}
