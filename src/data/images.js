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
 * Queue rows: { id, transactionId, userId, kind: 'upload' | 'delete', path, bytes?, blob? (rows queued before bytes), mime?,
 * status: 'pending' | 'failed' | 'local', tries, lastError }. A 'local' row is never uploaded: it holds the photo of an
 * offline scan until it has been read, when "Keep receipt photos" is off.
 *
 * With "Keep receipt photos" off (the default) nothing is uploaded: queued uploads are dropped and their transaction no
 * longer points at a photo; only the extracted data is kept. (`id` is the transactionId for uploads and `del:<path>` for deletes).
 *
 * The photo is kept as an ArrayBuffer (`bytes`) and uploaded as a raw body. A Blob read back from IndexedDB on iOS Safari
 * went out as a multipart part with no file in it, and Storage answered 400 "No content provided" for every photo.
 */
import { db, openDb } from './db';
import { supabase } from '../services/supabaseService';
import { getScanPrefs } from '../utils/scanPrefs';

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

const readBlob = (blob) =>
    typeof blob.arrayBuffer === 'function'
        ? blob.arrayBuffer()
        : new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error || new Error('Could not read the photo'));
              reader.readAsArrayBuffer(blob);
          });

/** The bytes of a photo (Blob, File, ArrayBuffer or typed array) as an ArrayBuffer. */
export async function toBytes(data) {
    if (!data) return null;
    if (data instanceof ArrayBuffer || Object.prototype.toString.call(data) === '[object ArrayBuffer]') return data; // (may come from another realm)
    if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return readBlob(data);
}

/** The queued photo of a row as a Blob (for previews, backups and re-reading), or null. */
export function queuedImageBlob(row) {
    if (!row || row.kind === 'delete') return null;
    const data = row.bytes || row.blob;
    if (!data) return null;
    return data instanceof Blob ? data : new Blob([new Uint8Array(data)], { type: row.mime || 'image/jpeg' });
}

const EMPTY_PHOTO = 'The photo is empty';

/**
 * Queue an image for upload (or, with `localOnly`, only keep it on this device). Returns the storage path to store as
 * `imagePath` (callers of a local-only photo store no path).
 */
export async function queueImage({ userId, transactionId, blob, mime, localOnly = false }) {
    if (!userId || !transactionId || !blob) throw new Error('userId, transactionId and blob are required');
    const bytes = await toBytes(blob);
    if (!bytes || bytes.byteLength === 0) throw new Error(EMPTY_PHOTO);
    const path = imagePathFor(userId, transactionId);
    await openDb();
    await db.images.put({ id: transactionId, transactionId, userId, kind: 'upload', path, bytes, mime: mime || blob.type || 'image/jpeg', status: localOnly ? 'local' : 'pending', tries: 0, lastError: null, createdAt: Date.now() });
    return path;
}

/** Drop the device-only photo of a transaction (after an offline scan was read). */
export async function dropLocalImage(transactionId) {
    await openDb();
    const row = await db.images.get(transactionId);
    if (row?.status === 'local') await db.images.delete(transactionId);
}

async function uploadRow(row) {
    const bytes = await toBytes(row.bytes || row.blob);
    if (!bytes || bytes.byteLength === 0) throw new Error(EMPTY_PHOTO);
    // Raw body (not a Blob): storage-js then sends the bytes with Content-Type instead of a multipart form
    const { error } = await supabase.storage.from(BUCKET).upload(row.path, new Uint8Array(bytes), { contentType: row.mime || 'image/jpeg', upsert: true });
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
            if (!getScanPrefs().saveImages) {
                // Photos are not kept: drop every queued upload (device-only scan photos stay until they are read)
                const drop = await db.images.filter((r) => r.kind === 'upload' && r.status !== 'local' && (!userId || !r.userId || r.userId === userId)).toArray();
                for (const r of drop) await discardImage(r.id);
            }
            // Photos rejected as empty before the raw-body fix get one more try
            const legacy = await db.images.filter((r) => r.status === 'failed' && /no content provided/i.test(r.lastError || '')).toArray();
            for (const r of legacy) await db.images.put({ ...r, status: 'pending', lastError: null });
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
                        await db.images.put({ ...row, tries: (row.tries || 0) + 1, lastError: err.message }); // whole row: keeps the bytes intact
                        break; // try again later, keep order
                    }
                    out.failed++;
                    await db.images.put({ ...row, status: 'failed', tries: (row.tries || 0) + 1, lastError: err.message });
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
        const local = queuedImageBlob(transactionId ? await db.images.get(transactionId) : null);
        if (local) {
            const url = URL.createObjectURL(local);
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
    const row = await db.images.get(id);
    if (row) await db.images.put({ ...row, status: 'pending', tries: 0, lastError: null });
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
