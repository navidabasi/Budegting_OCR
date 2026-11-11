/**
 * Receipt images: private Supabase Storage bucket `receipts`, object key `${userId}/${transactionId}.jpg`.
 *
 *  - `queueImage()` stores the blob in the Dexie `images` table first (so an offline scan is never lost)
 *    and returns the storage path to put on the transaction (`imagePath`).
 *  - `flushImages()` uploads queued blobs and performs queued deletes; sync.js calls it after the outbox.
 *  - `getImageUrl()` returns a local object URL while the upload is still queued, otherwise a signed URL
 *    (valid 1 hour, cached in memory for 55 minutes).
 *  - `removeImage()` deletes the object together with its transaction (queued when offline).
 *
 * Queue rows: { id, transactionId, userId, kind: 'upload' | 'delete', path, blob?, mime?, status, tries, lastError }
 * (`id` is the transactionId for uploads and `del:<path>` for deletes).
 */
import { db, openDb } from './db';
import { supabase } from '../services/supabaseService';

export const BUCKET = 'receipts';
export const SIGNED_URL_SECONDS = 3600;
const URL_CACHE_MS = 55 * 60 * 1000;

export const imagePathFor = (userId, transactionId) => `${userId}/${transactionId}.jpg`;

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const isTransient = (err) => {
    if (isOffline()) return true;
    const status = Number(err?.status || err?.statusCode);
    if (status >= 500 || status === 408 || status === 429) return true;
    return /failed to fetch|network|load failed|timed out|timeout|fetch failed/i.test(String(err?.message || '')) || err?.name === 'TypeError';
};

/** Queue an image for upload. Returns the storage path to store as `imagePath`. */
export async function queueImage({ userId, transactionId, blob, mime }) {
    if (!userId || !transactionId || !blob) throw new Error('userId, transactionId and blob are required');
    const path = imagePathFor(userId, transactionId);
    await openDb();
    await db.images.put({ id: transactionId, transactionId, userId, kind: 'upload', path, blob, mime: mime || blob.type || 'image/jpeg', status: 'pending', tries: 0, lastError: null, createdAt: Date.now() });
    return path;
}

async function uploadRow(row) {
    const { error } = await supabase.storage.from(BUCKET).upload(row.path, row.blob, { contentType: row.mime || 'image/jpeg', upsert: true });
    if (error) throw Object.assign(new Error(error.message || 'Upload failed'), { status: error.statusCode || error.status });
}

async function deleteRow(row) {
    const { error } = await supabase.storage.from(BUCKET).remove([row.path]);
    if (error) throw Object.assign(new Error(error.message || 'Delete failed'), { status: error.statusCode || error.status });
}

let flushing = null;

/** Upload queued images and apply queued deletes. Single-flight. Returns { uploaded, deleted, failed }. */
export function flushImages(userId = null) {
    if (!supabase || isOffline()) return Promise.resolve({ uploaded: 0, deleted: 0, failed: 0, skipped: true });
    if (flushing) return flushing;
    flushing = (async () => {
        const out = { uploaded: 0, deleted: 0, failed: 0 };
        try {
            await openDb();
            let rows = await db.images.filter((r) => r.status === 'pending').toArray();
            if (userId) rows = rows.filter((r) => !r.userId || r.userId === userId);
            rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            for (const row of rows) {
                try {
                    if (row.kind === 'delete') {
                        await deleteRow(row);
                        out.deleted++;
                    } else {
                        await uploadRow(row);
                        out.uploaded++;
                        urlCache.delete(row.path);
                    }
                    await db.images.delete(row.id);
                } catch (err) {
                    if (isTransient(err)) {
                        await db.images.update(row.id, { tries: (row.tries || 0) + 1, lastError: err.message });
                        break; // try again later, keep order
                    }
                    out.failed++;
                    await db.images.update(row.id, { status: 'failed', tries: (row.tries || 0) + 1, lastError: err.message });
                }
            }
        } finally {
            flushing = null;
        }
        return out;
    })();
    return flushing;
}

/** Fire and forget (after a save, when online). */
export function requestImageFlush(userId) {
    flushImages(userId).catch((err) => console.warn('[Images] flush failed:', err));
}

/**
 * Delete the stored image of a transaction (called when the transaction is deleted).
 * A not-yet-uploaded image is simply dropped from the queue.
 */
export async function removeImage({ userId, transactionId, imagePath, neverUploaded = false }) {
    try {
        await openDb();
        const queued = await db.images.get(transactionId);
        if (queued) await db.images.delete(transactionId);
        const path = imagePath || (queued && queued.path);
        urlCache.delete(path);
        if (!path || (queued && !imagePath) || (queued && neverUploaded)) return; // never reached the server
        await db.images.put({ id: `del:${path}`, transactionId, userId, kind: 'delete', path, status: 'pending', tries: 0, lastError: null, createdAt: Date.now() });
        requestImageFlush(userId);
    } catch (err) {
        console.warn('[Images] could not queue image delete:', err);
    }
}

const urlCache = new Map(); // path -> { url, at }

/** Signed URL (1 h) for a stored image; cached. Returns null when it cannot be created. */
export async function getSignedUrl(path) {
    if (!path || !supabase) return null;
    const hit = urlCache.get(path);
    if (hit && Date.now() - hit.at < URL_CACHE_MS) return hit.url;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) return null;
    urlCache.set(path, { url: data.signedUrl, at: Date.now() });
    return data.signedUrl;
}

/**
 * Best URL to show for a transaction's image: the local blob while it is still queued (works offline),
 * otherwise a signed URL. `revoke()` must be called by the consumer when it unmounts.
 */
export async function getImageUrl({ transactionId, imagePath }) {
    try {
        await openDb();
        const queued = transactionId ? await db.images.get(transactionId) : null;
        if (queued?.blob && queued.kind === 'upload') {
            const url = URL.createObjectURL(queued.blob);
            return { url, local: true, revoke: () => URL.revokeObjectURL(url) };
        }
    } catch {
        /* no local mirror */
    }
    if (isOffline()) return { url: null, local: false, revoke: () => {} };
    const url = await getSignedUrl(imagePath);
    return { url, local: false, revoke: () => {} };
}

/** All rows of the image queue (uploads and deletes), for sync state and "Needs attention". */
export async function listImageQueue() {
    try {
        await openDb();
        return await db.images.toArray();
    } catch {
        return [];
    }
}

/** Failed upload back to pending (and flush). */
export async function retryImage(id, userId = null) {
    await db.images.update(id, { status: 'pending', tries: 0, lastError: null });
    return flushImages(userId);
}

/** Give up on a queued photo: the file is dropped from the queue and the transaction no longer points at it. */
export async function discardImage(id) {
    const row = await db.images.get(id);
    if (!row) return false;
    await db.images.delete(id);
    if (row.kind === 'upload') {
        const { updateTransaction } = await import('./repo');
        await updateTransaction(row.transactionId, { imagePath: null }, { system: true }).catch(() => {});
    }
    return true;
}

export async function countQueuedImages() {
    try {
        await openDb();
        return await db.images.filter((r) => r.status === 'pending').count();
    } catch {
        return 0;
    }
}

export function __resetImagesForTests() {
    flushing = null;
    urlCache.clear();
}
