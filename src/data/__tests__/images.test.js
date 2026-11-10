import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = { uploads: [], removed: [], signed: [], failUpload: null };
vi.mock('../../services/supabaseService', () => ({
    supabase: {
        storage: {
            from: (bucket) => ({
                upload: async (path, blob, opts) => {
                    if (storage.failUpload) return { error: storage.failUpload };
                    storage.uploads.push({ bucket, path, type: opts.contentType });
                    return { error: null };
                },
                remove: async (paths) => {
                    storage.removed.push(...paths);
                    return { error: null };
                },
                createSignedUrl: async (path, secs) => {
                    storage.signed.push({ path, secs });
                    return { data: { signedUrl: `https://signed/${path}?t=${storage.signed.length}` }, error: null };
                },
            }),
        },
    },
    authHelpers: {},
    supabaseService: {},
}));

import { db, openDb } from '../db';
import { __resetImagesForTests, flushImages, getImageUrl, getSignedUrl, imagePathFor, queueImage, removeImage } from '../images';
import { createTransaction, deleteTransaction } from '../repo';

const blob = () => new Blob(['x'], { type: 'image/jpeg' });
const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    Object.assign(storage, { uploads: [], removed: [], signed: [], failUpload: null });
    __resetImagesForTests();
    setOnline(true);
});

describe('receipt images', () => {
    it('uses ${userId}/${transactionId}.jpg in bucket receipts', async () => {
        const path = await queueImage({ userId: 'u1', transactionId: 't1', blob: blob() });
        expect(path).toBe('u1/t1.jpg');
        expect(path).toBe(imagePathFor('u1', 't1'));
        const r = await flushImages('u1');
        expect(r.uploaded).toBe(1);
        expect(storage.uploads).toEqual([{ bucket: 'receipts', path: 'u1/t1.jpg', type: 'image/jpeg' }]);
        expect(await db.images.count()).toBe(0);
    });

    it('keeps the image queued while offline and flushes it when back online', async () => {
        setOnline(false);
        await queueImage({ userId: 'u1', transactionId: 't2', blob: blob() });
        expect((await flushImages('u1')).skipped).toBe(true);
        expect(await db.images.count()).toBe(1);
        // offline: the viewer gets the local blob (URL.createObjectURL is stubbed in jsdom)
        URL.createObjectURL = vi.fn(() => 'blob:local');
        URL.revokeObjectURL = vi.fn();
        const h = await getImageUrl({ transactionId: 't2', imagePath: 'u1/t2.jpg' });
        expect(h).toMatchObject({ url: 'blob:local', local: true });
        h.revoke();
        setOnline(true);
        expect((await flushImages('u1')).uploaded).toBe(1);
        expect(await db.images.count()).toBe(0);
    });

    it('retries on transient errors and parks permanent ones', async () => {
        await queueImage({ userId: 'u1', transactionId: 't3', blob: blob() });
        storage.failUpload = { message: 'Bad gateway', statusCode: 502 };
        await flushImages('u1');
        expect((await db.images.get('t3')).status).toBe('pending');
        storage.failUpload = { message: 'Bucket not found', statusCode: 404 };
        const r = await flushImages('u1');
        expect(r.failed).toBe(1);
        expect((await db.images.get('t3')).status).toBe('failed');
    });

    it('caches signed URLs (1 h)', async () => {
        const a = await getSignedUrl('u1/t4.jpg');
        const b = await getSignedUrl('u1/t4.jpg');
        expect(a).toBe(b);
        expect(storage.signed).toEqual([{ path: 'u1/t4.jpg', secs: 3600 }]);
        expect(await getSignedUrl('')).toBeNull();
    });

    it('deleting a transaction deletes its stored image', async () => {
        const id = await createTransaction({ userId: 'u1', merchant: 'Lidl', total: 5, date: '2026-11-01', category: 'Groceries', imagePath: 'u1/x.jpg' });
        await deleteTransaction(id);
        await new Promise((r) => setTimeout(r, 30));
        expect(storage.removed).toContain('u1/x.jpg');
    });

    it('a queued, never-uploaded image is just dropped on delete; imagePath is kept offline', async () => {
        setOnline(false);
        await queueImage({ userId: 'u1', transactionId: 't5', blob: blob() });
        await removeImage({ userId: 'u1', transactionId: 't5', imagePath: null });
        expect(await db.images.count()).toBe(0);
        const id = await createTransaction({ userId: 'u1', merchant: 'A', total: 1, date: '2026-11-01', category: 'Other', imagePath: 'u1/y.jpg' });
        await deleteTransaction(id);
        expect(await db.images.get('del:u1/y.jpg')).toBeTruthy(); // queued delete, flushed later
    });
});
