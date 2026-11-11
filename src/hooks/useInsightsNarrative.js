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

/**
 * The AI narrative for a month. Requests once per distinct data hash while online (the server caches by the same hash);
 * refresh() asks for a new one. status: idle | loading | ready | offline | notConfigured | rateLimit | error.
 */
export function useInsightsNarrative({ aggregates, language, enabled = true, fetchImpl }) {
    const online = useOnline();
    const [state, setState] = useState({ status: 'idle', data: null });
    const lastKey = useRef(null);
    const hash = aggregates ? hashAggregates(aggregates) : null;
    const aggRef = useRef(aggregates);
    aggRef.current = aggregates;

    const run = useCallback(
        async (refresh) => {
            if (!aggRef.current) return;
            setState((s) => ({ status: 'loading', data: s.data }));
            try {
                const data = await fetchNarrative({ aggregates: aggRef.current, language, refresh, getToken: getAccessToken, fetchImpl });
                setState({ status: 'ready', data });
            } catch (err) {
                const kind = err?.kind;
                const status = kind === 'offline' ? 'offline' : kind === 'notConfigured' ? 'notConfigured' : kind === 'rateLimit' ? 'rateLimit' : 'error';
                setState((s) => ({ status, data: s.data }));
            }
        },
        [language, fetchImpl]
    );

    useEffect(() => {
        if (!enabled || !hash) return;
        if (!online) {
            setState((s) => (s.status === 'ready' ? s : { status: 'offline', data: s.data }));
            return;
        }
        const key = `${hash}:${language}`;
        if (lastKey.current === key) return;
        lastKey.current = key;
        run(false);
    }, [enabled, hash, language, online, run]);

    return { ...state, online, refresh: () => run(true), retry: () => { lastKey.current = null; return run(false); } };
}
