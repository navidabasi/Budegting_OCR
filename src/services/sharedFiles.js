/**
 * Web Share Target storage. The service worker (src/sw.js) saves files shared into the app in IndexedDB
 * (own tiny database, no Dexie, no DOM) and redirects to /scan?shared=1; the scan page takes them out again.
 * Used from both the worker and the page, so it must only rely on indexedDB + File/Blob.
 */
const DB_NAME = 'wmw-share';
const STORE = 'files';

function openShareDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

const done = (tx) =>
    new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

/** Store shared files (as raw bytes). Returns how many were saved. */
export async function saveSharedFiles(files) {
    const rows = [];
    for (const f of files) rows.push({ name: f.name || 'receipt', type: f.type || 'application/octet-stream', data: await f.arrayBuffer(), at: Date.now() });
    if (!rows.length) return 0;
    const db = await openShareDb();
    try {
        const tx = db.transaction(STORE, 'readwrite');
        rows.forEach((r) => tx.objectStore(STORE).add(r));
        await done(tx);
    } finally {
        db.close();
    }
    return rows.length;
}

/** Read and clear all shared files (oldest first). Only images and PDFs are returned. */
export async function takeSharedFiles() {
    let db;
    try {
        db = await openShareDb();
    } catch {
        return [];
    }
    try {
        const rows = await new Promise((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (rows.length) {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).clear();
            await done(tx);
        }
        return rows
            .sort((a, b) => a.at - b.at)
            .filter((r) => /^image\//.test(r.type) || r.type === 'application/pdf' || /\.pdf$/i.test(r.name))
            .map((r) => new File([r.data], r.name, { type: r.type }));
    } finally {
        db.close();
    }
}

/** Service-worker side of POST /share: store the files, then redirect (303) to the scan page. */
export async function handleShareRequest(request) {
    try {
        const form = await request.formData();
        const files = form.getAll('files').filter((f) => f && typeof f === 'object' && typeof f.arrayBuffer === 'function');
        await saveSharedFiles(files);
    } catch (err) {
        console.warn('[share] could not store shared files', err);
    }
    return Response.redirect(new URL('/scan?shared=1', request.url).href, 303);
}
