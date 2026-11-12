import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));
import { db, openDb } from '../../data/db';
import { listTransactions } from '../../data/repo';
import { createPendingScan, processPendingScans } from '../pendingScans';
import { setScanPrefs } from '../../utils/scanPrefs';

const GOOD = { receipt: { merchant: 'Lidl', date: '2026-11-08', total: 23.47, currency: 'EUR', category: 'Groceries', items: [{ name: 'Latte', quantity: 1, price: 1.19 }], paymentMethod: 'card', confidence: { merchant: 1, date: 1, total: 1, items: 1 } }, extraction: { provider: 'vision' } };
const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    setOnline(false);
});

describe('offline scans', () => {
    it('with photos not kept: the photo stays on the device only until it is read, then only the data remains', async () => {
        setScanPrefs({ saveImages: false });
        const id = await createPendingScan({ userId: 'u1', file: new File(['x'], 'r.jpg', { type: 'image/jpeg' }), label: 'Receipt to read' });
        let [tx] = await listTransactions('u1');
        expect(tx.imagePath).toBeNull();
        expect((await db.images.get(id)).status).toBe('local');
        setOnline(true);
        const fetchImpl = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => GOOD });
        expect((await processPendingScans({ userId: 'u1', getToken: async () => 't', getHints: () => ({}), fetchImpl })).processed).toBe(1);
        [tx] = await listTransactions('u1');
        expect(tx).toMatchObject({ merchant: 'Lidl', total: 23.47, imagePath: null });
        expect(await db.images.count()).toBe(0);
    });

    it('queues the photo + placeholder, then reads it when back online', async () => {
        setScanPrefs({ saveImages: true });
        const id = await createPendingScan({ userId: 'u1', file: new File(['x'], 'r.jpg', { type: 'image/jpeg' }), label: 'Receipt to read' });
        let [tx] = await listTransactions('u1');
        expect(tx).toMatchObject({ id, merchant: 'Receipt to read', total: 0, extraction: { pending: true }, imagePath: `u1/${id}.jpg` });
        expect(await db.images.count()).toBe(1);

        const fetchImpl = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => GOOD });
        expect(await processPendingScans({ userId: 'u1', getToken: async () => 't', getHints: () => ({}), fetchImpl })).toMatchObject({ processed: 0 }); // still offline

        setOnline(true);
        const r = await processPendingScans({ userId: 'u1', getToken: async () => 't', getHints: () => ({}), fetchImpl });
        expect(r.processed).toBe(1);
        [tx] = await listTransactions('u1');
        expect(tx).toMatchObject({ merchant: 'Lidl', total: 23.47, category: 'Groceries' });
        expect(tx.extraction.pending).toBe(false);
        expect(tx.lineItems).toHaveLength(1);
    });

    it('keeps it pending on server errors, fails permanently on 422', async () => {
        await createPendingScan({ userId: 'u1', file: new File(['x'], 'r.jpg', { type: 'image/jpeg' }), label: 'x' });
        setOnline(true);
        const h = (status) => vi.fn().mockResolvedValue({ status, ok: false, json: async () => ({}) });
        expect((await processPendingScans({ userId: 'u1', getToken: async () => 't', getHints: () => ({}), fetchImpl: h(503) })).remaining).toBe(1);
        expect((await listTransactions('u1'))[0].extraction.pending).toBe(true);
        expect((await processPendingScans({ userId: 'u1', getToken: async () => 't', getHints: () => ({}), fetchImpl: h(422) })).failed).toBe(1);
        expect((await listTransactions('u1'))[0].extraction).toMatchObject({ pending: false, failed: true });
    });
});
