import { QueryClient } from '@tanstack/react-query';

/**
 * Single QueryClient for the app. All data queries live under the ['data', ...] key prefix and
 * read from the local Dexie mirror, so invalidating is cheap and works offline.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: Infinity, // data only changes through local writes or sync, both of which invalidate
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false, // the sync layer owns focus/online triggers
            refetchOnReconnect: false,
            retry: false,
            networkMode: 'always', // queries read IndexedDB, they must run offline
        },
        mutations: { networkMode: 'always', retry: false },
    },
});

/**
 * Replacement for the old window 'refresh*' events: refetch every data query.
 *
 * A query that is still on its FIRST fetch (no data yet) ignores an invalidation: TanStack Query hands back the fetch already in
 * flight, which may have read the mirror before this change was written. A chat answer saved a few milliseconds after its question
 * (an answer computed on the device) then never appeared until the page was reloaded. Those queries are fetched once more as soon
 * as their first fetch has settled.
 */
export function notifyDataChanged() {
    const firstFetches = queryClient
        .getQueryCache()
        .findAll({ queryKey: ['data'], fetchStatus: 'fetching' })
        .filter((q) => q.state.data === undefined)
        .map((q) => q.queryKey);
    const done = queryClient.invalidateQueries({ queryKey: ['data'] });
    // not awaited by the caller: a write must not wait for this second read (it only repairs what the screen shows)
    if (firstFetches.length) done.then(() => firstFetches.forEach((queryKey) => queryClient.refetchQueries({ queryKey, exact: true, type: 'active' }, { cancelRefetch: false }))).catch(() => {});
    return done;
}
