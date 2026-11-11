/**
 * JSON backup and restore of the user's local data (pass 2, section 8). Browser storage is not a backup: this file is.
 *
 * Format: { app: 'wmw-backup', version: 1, exportedAt, userId, tables: { <store>: rows[] }, images?: [{ transactionId, mime, data(base64) }] }
 * Rows are the app-format (camelCase) records of the Dexie mirror. Restore is additive and never overwrites newer data:
 *   - a row that does not exist is added (queued for sync like any new record, so it reaches Supabase)
 *   - a row that exists is replaced only when the backup copy has a newer updatedAt
 *   - settings are restored only when the account has none; photos are re-queued for upload
 * Rows are re-owned by the signed-in user (a backup made on another account can be loaded, the owner id is rewritten).
 */
import { db, openDb, STORES } from './db';
import { enqueue, requestFlush } from './sync';
import { getSignedUrl, queueImage } from './images';
import { notifyDataChanged } from './queryClient';

export const BACKUP_APP = 'wmw-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_TABLES = Object.keys(STORES).filter((name) => !STORES[name].paged); // chat history lives in the account, not in backup files

const time = (v) => {
    const n = Date.parse(v);
    return Number.isNaN(n) ? 0 : n;
};

const blobToBase64 = (blob) =>
    new Promise((resolve, reject) => {
        const r = new FileReader();
        if (!(blob instanceof Blob)) blob = new Blob([blob], { type: blob?.type || 'image/jpeg' }); // (structured clones in test environments lose the Blob class)
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(r.error || new Error('Could not read photo'));
        r.readAsDataURL(blob);
    });

const base64ToBlob = (b64, mime) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'image/jpeg' });
};

/** Photo of a transaction: the queued local file, else downloaded through a signed URL (needs a connection). null when unavailable. */
async function photoBlob(tx) {
    const queued = await db.images.get(tx.id);
    if (queued?.kind === 'upload' && queued.blob) return queued.blob;
    if (!tx.imagePath || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
    try {
        const url = await getSignedUrl(tx.imagePath);
        if (!url) return null;
        const res = await fetch(url);
        return res.ok ? await res.blob() : null;
    } catch {
        return null;
    }
}

/** Build the backup object. `includeImages` adds the receipt photos (downloaded when they are only in the cloud); `imagesMissing` counts the ones that could not be read. */
export async function exportBackup(userId, { includeImages = false, now = new Date() } = {}) {
    await openDb();
    const tables = {};
    for (const name of BACKUP_TABLES) {
        tables[name] = await db[name].where('userId').equals(userId).toArray();
    }
    const out = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), userId, counts: {}, tables };
    for (const name of BACKUP_TABLES) out.counts[name] = tables[name].length;
    if (includeImages) {
        out.images = [];
        out.imagesMissing = 0;
        for (const tx of tables.transactions.filter((t) => t.imagePath)) {
            const blob = await photoBlob(tx);
            if (!blob) {
                out.imagesMissing++;
                continue;
            }
            out.images.push({ transactionId: tx.id, mime: blob.type || 'image/jpeg', data: await blobToBase64(blob) });
        }
        out.counts.images = out.images.length;
    }
    return out;
}

export const backupFileName = (now = new Date()) => `wheremymoney-backup-${now.toISOString().slice(0, 10)}.json`;

/** Parse and validate a backup file's text. Throws Error('invalid_backup') for anything that is not one of ours. */
export function parseBackup(text) {
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error('invalid_backup');
    }
    if (!json || json.app !== BACKUP_APP || typeof json.tables !== 'object' || json.tables === null) throw new Error('invalid_backup');
    if (typeof json.version !== 'number' || json.version > BACKUP_VERSION) throw new Error('unsupported_backup');
    const counts = {};
    for (const name of BACKUP_TABLES) {
        if (json.tables[name] !== undefined && !Array.isArray(json.tables[name])) throw new Error('invalid_backup');
        counts[name] = (json.tables[name] || []).length;
    }
    counts.images = Array.isArray(json.images) ? json.images.length : 0;
    return { backup: json, counts };
}

/** What a restore would do, without writing anything: { added, updated, skipped } per table. */
export async function previewRestore(backup, userId) {
    await openDb();
    const out = {};
    for (const name of BACKUP_TABLES) {
        const rows = backup.tables[name] || [];
        const pk = STORES[name].pk;
        const r = { added: 0, updated: 0, skipped: 0 };
        for (const row of rows) {
            const key = STORES[name].singleton ? userId : row[pk];
            const existing = await db[name].get(key);
            if (!existing) r.added++;
            else if (STORES[name].singleton) r.skipped++;
            else if (time(row.updatedAt) > time(existing.updatedAt)) r.updated++;
            else r.skipped++;
        }
        out[name] = r;
    }
    return out;
}

export async function restoreBackup(backup, userId) {
    await openDb();
    const result = {};
    const pendingImages = [];
    for (const name of BACKUP_TABLES) {
        const rows = backup.tables[name] || [];
        const pk = STORES[name].pk;
        const r = { added: 0, updated: 0, skipped: 0 };
        await db.transaction('rw', db[name], db.outbox, async () => {
            for (const raw of rows) {
                const row = { ...raw, userId };
                if (STORES[name].singleton) row[pk] = userId;
                const existing = await db[name].get(row[pk]);
                if (existing && (STORES[name].singleton || time(row.updatedAt) <= time(existing.updatedAt))) {
                    r.skipped++;
                    continue;
                }
                await db[name].put(row);
                await enqueue({ table: name, op: existing ? 'upsert' : 'insert', recordId: row[pk], userId, payload: row, ts: row.updatedAt || new Date().toISOString() });
                if (existing) r.updated++;
                else r.added++;
            }
        });
        result[name] = r;
    }
    let photos = 0;
    for (const im of backup.images || []) {
        const tx = await db.transactions.get(im.transactionId);
        if (!tx || (await db.images.get(im.transactionId))) continue;
        try {
            // Re-uploading is harmless (upsert on the same path); it also repairs a photo that is missing in the cloud.
            const imagePath = await queueImage({ userId, transactionId: im.transactionId, blob: base64ToBlob(im.data, im.mime), mime: im.mime });
            if (!tx.imagePath) await db.transactions.update(im.transactionId, { imagePath });
            photos++;
        } catch {
            pendingImages.push(im.transactionId);
        }
    }
    result.images = { added: photos, skipped: (backup.images || []).length - photos, failed: pendingImages.length };
    requestFlush(userId);
    notifyDataChanged();
    return result;
}
