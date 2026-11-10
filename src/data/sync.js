/**
 * Sync engine: write outbox + pull-since-updated_at.
 *
 *  - Local writes call `enqueue()` (inside the same Dexie transaction as the mirror write).
 *  - `flushOutbox()` sends pending entries to Supabase in FIFO order (insert/update/upsert/delete).
 *  - `pullAll()` fetches rows with `updated_at >= cursor` per table into the mirror and
 *    reconciles rows deleted on other devices.
 *
 * Conflict rule: server `updated_at` wins unless the outbox entry is newer.
 *   - Flush: an update whose server row changed after the entry was queued is dropped.
 *   - Pull: a server row never overwrites the mirror while a newer outbox entry exists for it.
 *
 * See docs/adr/0001-storage.md.
 */
import { db, getMeta, setMeta, clearUserMirror, STORES, SYNC_ORDER, openDb } from './db';
import * as api from './api';
import { notifyDataChanged } from './queryClient';

const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const time = (v) => {
    const n = typeof v === 'number' ? v : Date.parse(v);
    return Number.isNaN(n) ? 0 : n;
};
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Observable sync state (for UI status and tests)
// ---------------------------------------------------------------------------
// attempted: a sync run finished (or was impossible), used to stop the "first load" spinner
const state = { syncing: false, pending: 0, failed: 0, lastSyncAt: null, lastError: null, hasPulled: false, attempted: false };
const listeners = new Set();
let snapshot = { ...state };

function emit() {
    snapshot = { ...state };
    listeners.forEach((l) => l());
}
export const getSyncState = () => snapshot;
export function subscribeSync(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export async function refreshOutboxCounts() {
    try {
        state.pending = await db.outbox.where('status').equals('pending').count();
        state.failed = await db.outbox.where('status').equals('failed').count();
        emit();
    } catch {
        /* mirror unavailable */
    }
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------
const inflight = new Set(); // seqs currently being sent: never coalesced into

/**
 * Queue a write. Must be called inside a Dexie rw transaction that includes `db.outbox`
 * (repo.js does this together with the mirror write).
 *   op: 'insert' (payload = full record) | 'update' (payload = changed fields)
 *     | 'upsert' (payload = full record, single-row tables) | 'delete'
 * Consecutive writes to the same record are coalesced while still pending.
 */
export async function enqueue({ table, op, recordId, userId, payload = null, ts = nowIso() }) {
    const same = (await db.outbox.where('recordId').equals(recordId).toArray())
        .filter((e) => e.table === table && e.status === 'pending' && !inflight.has(e.seq))
        .sort((a, b) => a.seq - b.seq);

    if (op === 'delete') {
        // A record that never reached the server needs no delete at all.
        const neverSent = same.some((e) => e.op === 'insert');
        if (same.length) await db.outbox.bulkDelete(same.map((e) => e.seq));
        if (neverSent) return null;
    } else if ((op === 'update' || op === 'upsert') && same.length) {
        const last = same[same.length - 1];
        // Only merge when nothing else was queued after `last` for any record (keeps FIFO order intact).
        const newest = await db.outbox.orderBy('seq').last();
        if (newest && newest.seq === last.seq && (last.op === 'insert' || last.op === 'update' || last.op === 'upsert')) {
            const mergedOp = last.op === 'update' && op === 'upsert' ? 'upsert' : last.op;
            await db.outbox.update(last.seq, {
                op: mergedOp,
                payload: op === 'upsert' ? payload : { ...last.payload, ...payload },
                ts,
            });
            return last.seq;
        }
    }
    return db.outbox.add({ table, op, recordId, userId, payload, ts, tries: 0, status: 'pending', lastError: null });
}

async function applyEntry(entry, ownWrites) {
    const { table, op, recordId, payload, ts } = entry;

    if (op === 'delete') {
        if (table === 'groups') await api.removeGroup(recordId);
        else await api.remove(table, recordId);
        return { result: 'done' };
    }

    if (op === 'insert') {
        const saved = await api.insert(table, payload);
        if (saved?.updatedAt) ownWrites.set(`${table}:${recordId}`, time(saved.updatedAt));
        return { result: 'done' };
    }

    // update / upsert: apply the conflict rule against the server row
    const serverUpdatedAt = await api.fetchUpdatedAt(table, recordId);
    if (serverUpdatedAt) {
        const serverTime = time(serverUpdatedAt);
        const ours = ownWrites.get(`${table}:${recordId}`);
        if (serverTime > time(ts) && serverTime !== ours) {
            return { result: 'conflict', reason: 'server-newer' };
        }
    } else if (op === 'update') {
        return { result: 'conflict', reason: 'deleted-on-server' };
    }
    const saved = op === 'update' ? await api.update(table, recordId, payload) : await api.upsert(table, payload);
    if (saved?.updatedAt) ownWrites.set(`${table}:${recordId}`, time(saved.updatedAt));
    return { result: 'done' };
}

let flushing = null;
let flushAgain = false;

async function runFlush(userId) {
    const result = { pushed: 0, conflicts: [], errors: [], stopped: false };
    let entries = await db.outbox.where('status').equals('pending').sortBy('seq');
    if (userId) entries = entries.filter((e) => !e.userId || e.userId === userId);

    const ownWrites = new Map();
    const blockedTables = new Set();

    for (const entry of entries) {
        if (blockedTables.has(entry.table)) continue;
        inflight.add(entry.seq);
        try {
            const outcome = await applyEntry(entry, ownWrites);
            await db.outbox.delete(entry.seq);
            if (outcome.result === 'conflict') {
                result.conflicts.push({ table: entry.table, id: entry.recordId, reason: outcome.reason });
            } else {
                result.pushed++;
            }
        } catch (err) {
            const message = err?.message || String(err);
            if (api.isMissingTableError(err) && STORES[entry.table]?.optional) {
                if (STORES[entry.table].optional === 'drop') {
                    await db.outbox.delete(entry.seq); // table absent: keep the data local only
                } else {
                    blockedTables.add(entry.table); // v13 table not migrated yet: keep queued
                }
                continue;
            }
            if (api.isTransientError(err)) {
                await db.outbox.update(entry.seq, { tries: (entry.tries || 0) + 1, lastError: message });
                result.errors.push({ type: entry.table, id: entry.recordId, error: message });
                result.stopped = true; // FIFO: do not send later entries past a transient failure
                break;
            }
            // Permanent failure (validation, RLS, constraint): park it so it does not block the queue.
            await db.outbox.update(entry.seq, { status: 'failed', tries: (entry.tries || 0) + 1, lastError: message });
            result.errors.push({ type: entry.table, id: entry.recordId, error: message });
        } finally {
            inflight.delete(entry.seq);
        }
    }
    return result;
}

/** Flush pending outbox entries (single-flight; entries queued meanwhile trigger another pass). */
export function flushOutbox(userId = null) {
    if (!api.isConfigured() || isOffline()) {
        return Promise.resolve({ pushed: 0, conflicts: [], errors: [], stopped: false, skipped: true });
    }
    if (flushing) {
        flushAgain = true;
        return flushing;
    }
    flushing = (async () => {
        const total = { pushed: 0, conflicts: [], errors: [], stopped: false };
        try {
            await openDb();
            do {
                flushAgain = false;
                const r = await runFlush(userId);
                total.pushed += r.pushed;
                total.conflicts.push(...r.conflicts);
                total.errors.push(...r.errors);
                total.stopped = r.stopped;
            } while (flushAgain && !total.stopped);
        } finally {
            flushing = null;
            await refreshOutboxCounts();
        }
        if (total.pushed || total.conflicts.length) notifyDataChanged();
        return total;
    })();
    return flushing;
}

/** Fire-and-forget flush used right after a local write ("online: flush immediately"). */
export function requestFlush(userId = null) {
    if (!api.isConfigured() || isOffline()) {
        refreshOutboxCounts();
        return;
    }
    flushOutbox(userId).catch((err) => console.warn('[Sync] flush failed:', err));
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------
async function pendingByRecord(table) {
    const entries = await db.outbox.where('table').equals(table).filter((e) => e.status === 'pending').toArray();
    const map = new Map();
    for (const e of entries) {
        const list = map.get(e.recordId) || [];
        list.push(e);
        map.set(e.recordId, list);
    }
    return map;
}

export async function pullTable(userId, table) {
    const { pk } = STORES[table];
    const cursorKey = `cursor:${userId}:${table}`;
    const since = await getMeta(cursorKey);
    const rows = await api.fetchSince(table, userId, since);
    const out = { downloaded: 0, updated: 0, conflicts: [] };
    if (!rows.length) return out;

    await db.transaction('rw', db[table], db.outbox, async () => {
        const pending = await pendingByRecord(table);
        for (const row of rows) {
            const key = row[pk];
            const entries = pending.get(key) || [];
            const newest = entries.reduce((m, e) => Math.max(m, time(e.ts)), 0);
            if (newest > time(row.updatedAt)) continue; // local change is newer: keep it, it will be flushed
            if (entries.length) {
                await db.outbox.bulkDelete(entries.map((e) => e.seq)); // server wins
                out.conflicts.push({ table, id: key, reason: 'server-newer' });
            }
            const existing = await db[table].get(key);
            await db[table].put(row);
            if (existing) out.updated++;
            else out.downloaded++;
        }
    });

    const maxUpdated = rows.reduce((m, r) => (time(r.updatedAt) > time(m) ? r.updatedAt : m), since || rows[0].updatedAt);
    await setMeta(cursorKey, maxUpdated);
    return out;
}

/** Remove mirror rows whose server row no longer exists (deleted on another device). */
export async function reconcileTable(userId, table) {
    if (STORES[table].singleton) return 0;
    const serverIds = new Set(await api.fetchIds(table, userId));
    const localKeys = await db[table].where('userId').equals(userId).primaryKeys();
    const pending = await pendingByRecord(table);
    const doomed = localKeys.filter((k) => !serverIds.has(k) && !pending.has(k));
    if (doomed.length) await db[table].bulkDelete(doomed);
    return doomed.length;
}

export async function pullAll(userId, { reconcile = false } = {}) {
    const out = { downloaded: 0, updated: 0, deleted: 0, conflicts: [], errors: [] };
    const unavailable = pullAll.unavailable || (pullAll.unavailable = new Set());
    const lastReconcile = (await getMeta(`lastReconcile:${userId}`)) || 0;
    const doReconcile = reconcile || Date.now() - lastReconcile > RECONCILE_INTERVAL_MS;
    let reconciled = false;

    for (const table of SYNC_ORDER) {
        if (unavailable.has(table)) continue;
        try {
            const r = await pullTable(userId, table);
            out.downloaded += r.downloaded;
            out.updated += r.updated;
            out.conflicts.push(...r.conflicts);
            if (doReconcile) {
                out.deleted += await reconcileTable(userId, table);
                reconciled = true;
            }
        } catch (err) {
            if (api.isMissingTableError(err) && STORES[table].optional) {
                unavailable.add(table);
                continue;
            }
            out.errors.push({ type: table, error: err?.message || String(err) });
        }
    }
    if (reconciled) await setMeta(`lastReconcile:${userId}`, Date.now());
    return out;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
let running = null;

/**
 * Push local changes, then pull server changes. Single-flight: concurrent callers share one run.
 * Returns { uploaded, downloaded, updated, deleted, conflicts, errors, skipped? }.
 */
export function syncNow(userId, { reason = 'manual', reconcile = false } = {}) {
    if (!userId || !api.isConfigured()) {
        if (!state.attempted) {
            state.attempted = true;
            emit();
        }
        return Promise.resolve({ uploaded: 0, downloaded: 0, updated: 0, deleted: 0, conflicts: [], errors: [], skipped: 'unconfigured' });
    }
    if (isOffline()) {
        return Promise.resolve({ uploaded: 0, downloaded: 0, updated: 0, deleted: 0, conflicts: [], errors: [], skipped: 'offline' });
    }
    if (running) return running;

    running = (async () => {
        state.syncing = true;
        emit();
        try {
            await openDb();
            const push = await flushOutbox(userId); // push first so local changes are never lost
            // Receipt photos queued offline (a transaction row must exist before its image, so after the outbox)
            await import('./images').then((m) => m.flushImages(userId)).catch((err) => console.warn('[Sync] image flush failed:', err));
            const pull = await pullAll(userId, { reconcile });
            const errors = [...push.errors, ...pull.errors];
            state.lastSyncAt = nowIso();
            state.attempted = true;
            state.lastError = errors.length ? errors[0].error : null;
            state.hasPulled = state.hasPulled || pull.errors.length === 0;
            notifyDataChanged();
            return {
                uploaded: push.pushed,
                downloaded: pull.downloaded,
                updated: pull.updated,
                deleted: pull.deleted,
                conflicts: [...push.conflicts, ...pull.conflicts],
                errors,
                reason,
            };
        } catch (err) {
            state.attempted = true;
            state.lastError = err?.message || String(err);
            throw err;
        } finally {
            state.syncing = false;
            running = null;
            await refreshOutboxCounts();
        }
    })();
    return running;
}

/** Flush what is pending, wipe this user's mirror and pull everything again. */
export async function clearAndResync(userId) {
    await openDb();
    await flushOutbox(userId);
    await clearUserMirror(userId);
    notifyDataChanged();
    const r = await syncNow(userId, { reason: 'resync', reconcile: true });
    return { cleared: true, pulled: r.downloaded + r.updated, errors: r.errors };
}

/** Register online / focus / visibility / interval triggers. Returns a stop function. */
export function startSync(userId) {
    if (!userId) return () => {};
    // A new session starts "cold": hooks show a loading state until this user's first sync finishes
    state.hasPulled = false;
    state.attempted = false;
    emit();
    const run = (reason) => syncNow(userId, { reason }).catch((err) => console.error(`[Sync] ${reason} failed:`, err));
    const onOnline = () => run('online');
    const onFocus = () => run('focus');
    const onVisibility = () => {
        if (document.visibilityState === 'visible') run('visibility');
    };
    const interval = setInterval(() => run('interval'), SYNC_INTERVAL_MS);
    run('startup');
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
        clearInterval(interval);
        window.removeEventListener('online', onOnline);
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
    };
}

/** Test helper: reset module-level state between tests. */
export function __resetSyncForTests() {
    flushing = null;
    flushAgain = false;
    running = null;
    inflight.clear();
    if (pullAll.unavailable) pullAll.unavailable.clear();
    Object.assign(state, { syncing: false, pending: 0, failed: 0, lastSyncAt: null, lastError: null, hasPulled: false, attempted: false });
    emit();
}
