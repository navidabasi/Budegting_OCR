/** React hooks for sync state, drafts and storage (pass 2, section 8). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';
import { openDb } from './db';
import { getDraft, subscribeDrafts } from './drafts';
import { listConflicts, listOutbox, retryAllFailed, syncNow } from './sync';
import { listImageQueue } from './images';
import { computeRecordSyncStates, summarizeQueue } from './syncState';
import { useSyncStatus } from './hooks';
import { getStorageEstimate } from './storage';

const EMPTY = Object.freeze([]);
const useUserId = () => useAppStore((s) => s.currentUser?.userId || null);

export function useOnline() {
    const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
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
}

/** Outbox + image queue + conflict log of this device, refreshed whenever the sync state or the data changes. */
export function useSyncQueue() {
    const userId = useUserId();
    const sync = useSyncStatus();
    const online = useOnline();
    const query = useQuery({
        queryKey: ['data', 'syncqueue', userId, sync.pending, sync.failed, sync.lastSyncAt, sync.syncing, online],
        enabled: !!userId,
        queryFn: async () => {
            await openDb();
            const [outbox, images, conflicts] = await Promise.all([listOutbox(), listImageQueue(), listConflicts(userId)]);
            return { outbox: outbox.filter((e) => !e.userId || e.userId === userId), images: images.filter((i) => !i.userId || i.userId === userId), conflicts };
        },
    });
    const data = query.data || { outbox: EMPTY, images: EMPTY, conflicts: EMPTY };
    const summary = useMemo(() => summarizeQueue({ outbox: data.outbox, images: data.images, online }), [data, online]);
    const retryNow = useCallback(async () => {
        await retryAllFailed(userId).catch(() => {});
        return syncNow(userId, { reason: 'retry' });
    }, [userId]);
    return { ...data, summary, online, syncing: sync.syncing, lastSyncAt: sync.lastSyncAt, lastError: sync.lastError, retryNow };
}

/** Map transactionId -> { record, image, analysis, overall } for the given transactions. */
export function useRecordSyncStates(transactions) {
    const { outbox, images, online } = useSyncQueue();
    return useMemo(() => computeRecordSyncStates({ transactions: transactions || EMPTY, outbox, images, online }), [transactions, outbox, images, online]);
}

/** The saved draft of a kind ('quickadd' | 'scan') or null; stays in step with saves and deletes. */
export function useDraft(kind) {
    const userId = useUserId();
    const [draft, setDraft] = useState(null);
    useEffect(() => {
        let alive = true;
        const load = () => getDraft(userId, kind).then((d) => alive && setDraft(d));
        load();
        const off = subscribeDrafts(load);
        return () => {
            alive = false;
            off();
        };
    }, [userId, kind]);
    return draft;
}

export function useStorageEstimate() {
    const [info, setInfo] = useState(null);
    const refresh = useCallback(() => getStorageEstimate().then(setInfo), []);
    useEffect(() => {
        refresh();
    }, [refresh]);
    return { info, refresh };
}
