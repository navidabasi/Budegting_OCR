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

/** Replacement for the old window 'refresh*' events: refetch every data query. */
export function notifyDataChanged() {
    return queryClient.invalidateQueries({ queryKey: ['data'] });
}
