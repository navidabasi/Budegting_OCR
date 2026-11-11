/**
 * Durable storage helpers (pass 2, section 8): ask the browser not to evict the local database and report how much of
 * the quota is used. Both are best effort and never throw; browser storage is not a backup (see backup.js).
 */
const hasStorage = () => typeof navigator !== 'undefined' && navigator.storage;

/** Ask for persistent storage. Resolves to true / false, or null when the browser has no such API. */
export async function requestPersistentStorage() {
    try {
        if (!hasStorage() || typeof navigator.storage.persist !== 'function') return null;
        if (typeof navigator.storage.persisted === 'function' && (await navigator.storage.persisted())) return true;
        return await navigator.storage.persist();
    } catch {
        return null;
    }
}

/** { supported, usage, quota, persisted } in bytes; usage/quota null when the browser does not say. */
export async function getStorageEstimate() {
    const out = { supported: !!hasStorage(), usage: null, quota: null, persisted: null };
    try {
        if (hasStorage() && typeof navigator.storage.estimate === 'function') {
            const e = await navigator.storage.estimate();
            out.usage = Number.isFinite(e?.usage) ? e.usage : null;
            out.quota = Number.isFinite(e?.quota) ? e.quota : null;
        }
        if (hasStorage() && typeof navigator.storage.persisted === 'function') out.persisted = await navigator.storage.persisted();
    } catch {
        /* keep what we have */
    }
    return out;
}

export function formatBytes(n) {
    if (!Number.isFinite(n) || n < 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
