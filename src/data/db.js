/**
 * Local IndexedDB mirror (Dexie) of the user's Supabase data plus the write outbox.
 *
 * Reads in the UI always come from this mirror (instant, works offline). Writes are
 * applied to the mirror optimistically and queued in `outbox`; src/data/sync.js flushes
 * the outbox to Supabase and pulls server changes back into the mirror.
 * See docs/adr/0001-storage.md.
 */
import Dexie from 'dexie';

export const DB_NAME = 'wmw-data-v1';

/**
 * Mirror stores that are synced with Supabase, with primary key and sync behaviour.
 * `optional: 'drop'`  - a missing remote table is tolerated by discarding queued writes.
 * `optional: 'keep'`  - a missing remote table is skipped; queued writes stay in the outbox.
 * Lives here (not in api.js) so the outbox/mirror logic does not depend on the API layer.
 */
export const STORES = {
    transactions: { pk: 'id' }, // Supabase table: receipts
    groups: { pk: 'id' },
    categories: { pk: 'id' }, // Supabase table: user_categories
    settings: { pk: 'userId', singleton: true }, // one row per user
    layouts: { pk: 'userId', singleton: true, optional: 'drop' }, // user_layouts; table may be missing in old deployments
    // v13 tables (supabase/migrations/20261110_v13_...): skipped until the migration is applied, writes stay queued
    accounts: { pk: 'id', optional: 'keep' },
    budgets: { pk: 'id', optional: 'keep' },
    goals: { pk: 'id', optional: 'keep' }, // Supabase table: savings_goals
    rules: { pk: 'id', optional: 'keep' }, // Supabase table: merchant_rules
};

export const SYNC_ORDER = Object.keys(STORES);

export const db = new Dexie(DB_NAME);

// Schema v1. Add indexes only for fields that are queried (see docs/IMPROVEMENT_PLAN.md section 8).
db.version(1).stores({
    transactions: 'id, userId, date, [userId+date], groupId, updatedAt',
    groups: 'id, userId, updatedAt',
    categories: 'id, userId, name',
    settings: 'userId',
    layouts: 'userId',
    accounts: 'id, userId',
    budgets: 'id, userId, startsOn',
    goals: 'id, userId',
    rules: 'id, userId, merchantKey',
    // op: insert | update | upsert | delete; status: pending | failed
    outbox: '++seq, table, recordId, status',
    images: 'id, transactionId', // receipt image upload queue (Phase 2)
    meta: 'key',
});

let openPromise = null;
const health = {
    hasLocalCache: true,
    initFailed: false,
    fallbackMode: false,
    lastError: null,
    lastAttemptAt: null,
};

/** Open the database once; resolves to true when the local mirror is usable. */
export function openDb({ force = false } = {}) {
    if (openPromise && !force) return openPromise;
    health.lastAttemptAt = Date.now();
    openPromise = db
        .open()
        .then(() => {
            health.hasLocalCache = true;
            health.initFailed = false;
            health.fallbackMode = false;
            health.lastError = null;
            return true;
        })
        .catch((err) => {
            console.error('[Data] Local IndexedDB mirror unavailable:', err);
            health.hasLocalCache = false;
            health.initFailed = true;
            health.fallbackMode = true;
            health.lastError = err?.message || 'IndexedDB unavailable';
            return false;
        });
    return openPromise;
}

export function getStorageHealth() {
    return { ...health };
}

export async function getMeta(key, fallback = null) {
    const row = await db.meta.get(key);
    return row ? row.value : fallback;
}

export async function setMeta(key, value) {
    await db.meta.put({ key, value });
}

/** Remove all mirror rows (and sync cursors) belonging to a user. The outbox is kept. */
export async function clearUserMirror(userId) {
    const stores = Object.keys(STORES);
    await db.transaction('rw', [...stores.map((s) => db[s]), db.meta], async () => {
        for (const s of stores) {
            await db[s].where('userId').equals(userId).delete();
        }
        const cursorKeys = await db.meta.where('key').startsWith(`cursor:${userId}:`).primaryKeys();
        await db.meta.bulkDelete(cursorKeys);
        await db.meta.delete(`lastReconcile:${userId}`);
    });
}

/** Remove everything (used on logout of the last user / full reset). */
export async function clearAllLocalData() {
    await db.transaction('rw', db.tables, async () => {
        for (const table of db.tables) {
            await table.clear();
        }
    });
}
