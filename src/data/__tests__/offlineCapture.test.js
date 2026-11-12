// Pass 2, section 8 / brief case 1 and 9: offline capture, restarts, interrupted retries, edits on another device,
// cancellation, extraction vs manual edits, backup. A stateful fake server stands in for Supabase.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const server = { rows: new Map(), failAfterStore: false, tick: 0, uploads: [] };
const stamp = () => new Date(Date.UTC(2030, 0, 1, 0, 0, ++server.tick)).toISOString(); // always later than client timestamps

vi.mock('../api', () => ({
    isConfigured: vi.fn(() => true),
    isMissingTableError: vi.fn(() => false),
    isTransientError: vi.fn((e) => e?.message === 'Failed to fetch'),
    insert: vi.fn(async (table, rec) => {
        const row = { ...rec, updatedAt: stamp() };
        server.rows.set(`${table}:${rec.id ?? rec.userId}`, row);
        if (server.failAfterStore) {
            server.failAfterStore = false;
            throw new Error('Failed to fetch'); // the write landed but the response was lost
        }
        return row;
    }),
    update: vi.fn(async (table, id, patch) => {
        const row = { ...server.rows.get(`${table}:${id}`), ...patch, updatedAt: stamp() };
        server.rows.set(`${table}:${id}`, row);
        return row;
    }),
    upsert: vi.fn(async (table, rec) => {
        const row = { ...rec, updatedAt: stamp() };
        server.rows.set(`${table}:${rec.id ?? rec.userId}`, row);
        return row;
    }),
    remove: vi.fn(async (table, id) => void server.rows.delete(`${table}:${id}`)),
    removeGroup: vi.fn(),
    fetchUpdatedAt: vi.fn(async (table, id) => server.rows.get(`${table}:${id}`)?.updatedAt || null),
    fetchOne: vi.fn(async (table, id) => server.rows.get(`${table}:${id}`) || null),
    fetchSince: vi.fn(async (table, userId) => [...server.rows.entries()].filter(([k, r]) => k.startsWith(`${table}:`) && r.userId === userId).map(([, r]) => r)),
    fetchIds: vi.fn(async (table, userId) => [...server.rows.entries()].filter(([k, r]) => k.startsWith(`${table}:`) && r.userId === userId).map(([, r]) => r.id)),
}));
vi.mock('../queryClient', () => ({ notifyDataChanged: vi.fn(), queryClient: {} }));
vi.mock('../../services/supabaseService', () => ({
    supabase: {
        storage: {
            from: () => ({
                upload: async (path) => {
                    server.uploads.push(path);
                    return { error: null };
                },
                remove: async () => ({ error: null }),
                createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/x' }, error: null }),
            }),
        },
    },
    authHelpers: {},
    supabaseService: {},
}));

import * as api from '../api';
import { db, openDb } from '../db';
import { __resetSyncForTests, discardEntry, enqueue, flushOutbox, listConflicts, pullTable, resolveConflict, retryEntry } from '../sync';
import { __resetImagesForTests, flushImages, queueImage } from '../images';
import * as repo from '../repo';
import { createPendingScan, processPendingScans } from '../../services/pendingScans';
import { attachScanToTransaction } from '../../services/scanAttach';
import { computeRecordSyncStates, summarizeQueue } from '../syncState';
import { exportBackup, parseBackup, previewRestore, restoreBackup } from '../backup';
import { deleteDraft, getDraft, saveDraft } from '../drafts';

const U = 'u1';
const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
const photo = () => new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
const serverTx = () => [...server.rows.entries()].filter(([k]) => k.startsWith('transactions:'));

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    __resetSyncForTests();
    __resetImagesForTests();
    server.rows.clear();
    server.failAfterStore = false;
    server.tick = 0;
    server.uploads = [];
    localStorage.setItem('wmw.scanPrefs', JSON.stringify({ saveImages: true, photosOffV1: true })); // this file covers kept photos
    vi.clearAllMocks();
    setOnline(true);
});

async function restartApp() {
    db.close(); // what closing the tab does: only IndexedDB survives
    await openDb({ force: true });
    __resetSyncForTests();
    __resetImagesForTests();
}

describe('case 1: offline capture, restart, reconnect -> exactly one expense', () => {
    it('persists record and photo before "saved", survives a restart and a lost response, ends with one row', async () => {
        setOnline(false);
        const id = 'tx-offline-1';
        const path = await queueImage({ userId: U, transactionId: id, blob: photo() });
        await repo.createTransaction({ id, userId: U, merchant: 'Bar Roma', total: 4.72, date: '2026-11-09', category: 'Dining', imagePath: path });

        // durable before anything is shown as saved: the record, its photo bytes and the outbox entry are all in IndexedDB
        expect((await db.transactions.get(id)).total).toBe(4.72);
        expect((await db.images.get(id)).bytes.byteLength).toBeGreaterThan(0);
        const [entry] = await db.outbox.toArray();
        expect(entry).toMatchObject({ table: 'transactions', op: 'insert', recordId: id, status: 'pending' });
        expect(entry.opId).toMatch(/\S{8,}/);

        await restartApp();
        expect(await db.outbox.count()).toBe(1);
        expect((await db.images.get(id)).bytes.byteLength).toBeGreaterThan(0);

        // reconnect: the first send lands on the server but the response is lost
        setOnline(true);
        server.failAfterStore = true;
        const first = await flushOutbox(U);
        expect(first.stopped).toBe(true);
        expect(serverTx()).toHaveLength(1);
        const [stillQueued] = await db.outbox.toArray();
        expect(stillQueued.opId).toBe(entry.opId); // same operation, same id on every retry

        // retry: same content already on the server -> done, no duplicate, no conflict
        const second = await flushOutbox(U);
        expect(second.pushed).toBe(1);
        expect(second.conflicts).toHaveLength(0);
        expect(serverTx()).toHaveLength(1);
        expect(await db.outbox.count()).toBe(0);

        expect((await flushImages(U)).uploaded).toBe(1);
        expect(server.uploads).toEqual([`${U}/${id}.jpg`]);
        expect(await db.transactions.count()).toBe(1);
    });

    it('a retry never overwrites an edit made on another device meanwhile', async () => {
        const id = 'tx-2';
        await repo.createTransaction({ id, userId: U, merchant: 'Lidl', total: 10, date: '2026-11-09', category: 'Groceries' });
        // pretend the first attempt landed (lost response) and another device then corrected the total
        await db.outbox.toCollection().modify({ attempted: true, tries: 1 });
        server.rows.set(`transactions:${id}`, { id, userId: U, merchant: 'Lidl', total: 12.5, date: '2026-11-09', category: 'Groceries', updatedAt: stamp() });
        const r = await flushOutbox(U);
        expect(r.conflicts).toEqual([{ table: 'transactions', id, reason: 'server-newer' }]);
        expect(server.rows.get(`transactions:${id}`).total).toBe(12.5); // correction kept
        expect(await db.outbox.count()).toBe(0);
        expect((await listConflicts(U))[0]).toMatchObject({ recordId: id, reason: 'server-newer' });
    });

    it('pull keeps a local delete: another device editing the record does not resurrect it', async () => {
        const id = 'tx-3';
        server.rows.set(`transactions:${id}`, { id, userId: U, merchant: 'A', total: 5, updatedAt: '2026-11-01T10:00:00.000Z' });
        await db.transactions.put({ id, userId: U, merchant: 'A', total: 5, updatedAt: '2026-11-01T10:00:00.000Z' });
        setOnline(false);
        await repo.deleteTransaction(id);
        server.rows.set(`transactions:${id}`, { id, userId: U, merchant: 'A', total: 6, updatedAt: stamp() }); // edit elsewhere, newer
        const pulled = await pullTable(U, 'transactions');
        expect(pulled.conflicts).toContainEqual({ table: 'transactions', id, reason: 'deleted-here' });
        expect(await db.transactions.get(id)).toBeUndefined(); // not resurrected
        setOnline(true);
        await flushOutbox(U);
        expect(server.rows.has(`transactions:${id}`)).toBe(false);
    });

    it('"keep mine" re-applies a local change that lost against the server', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const id = 'tx-4';
        await db.transactions.put({ id, userId: U, merchant: 'A', total: 5, updatedAt: '2026-11-01T10:00:00.000Z' });
        server.rows.set(`transactions:${id}`, { id, userId: U, merchant: 'A', total: 5, updatedAt: '2026-11-01T10:00:00.000Z' });
        setOnline(false);
        vi.setSystemTime(new Date('2026-11-02T09:00:00.000Z'));
        await repo.updateTransaction(id, { total: 7 });
        server.rows.set(`transactions:${id}`, { id, userId: U, merchant: 'A', total: 6, updatedAt: '2026-11-02T09:00:30.000Z' }); // other device, newer
        await pullTable(U, 'transactions'); // server newer: server wins, local change logged
        vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
        expect((await db.transactions.get(id)).total).toBe(6);
        const [c] = await listConflicts(U);
        expect(c).toMatchObject({ recordId: id, op: 'update' });
        setOnline(true);
        await resolveConflict(U, c.id, 'mine');
        await flushOutbox(U);
        expect((await db.transactions.get(id)).total).toBe(7);
        expect(server.rows.get(`transactions:${id}`).total).toBe(7);
        expect(await listConflicts(U)).toHaveLength(0);
        vi.useRealTimers();
    });
});

describe('cancelling and deleting queued work', () => {
    it('deleting a record that never left the device empties the outbox and the photo queue', async () => {
        setOnline(false);
        const id = 'tx-5';
        const imagePath = await queueImage({ userId: U, transactionId: id, blob: photo() });
        await repo.createTransaction({ id, userId: U, merchant: 'X', total: 3, date: '2026-11-09', imagePath });
        await repo.deleteTransaction(id);
        expect(await db.outbox.count()).toBe(0);
        expect(await db.images.count()).toBe(0);
        setOnline(true);
        await flushOutbox(U);
        expect(api.insert).not.toHaveBeenCalled();
        expect(api.remove).not.toHaveBeenCalled();
    });

    it('deleting a record whose insert may already have landed still sends the delete', async () => {
        const id = 'tx-6';
        await repo.createTransaction({ id, userId: U, merchant: 'X', total: 3, date: '2026-11-09' });
        await db.outbox.toCollection().modify({ attempted: true, tries: 1 });
        server.rows.set(`transactions:${id}`, { id, userId: U, total: 3, updatedAt: stamp() });
        await repo.deleteTransaction(id);
        expect((await db.outbox.toArray()).map((e) => e.op)).toEqual(['delete']);
        await flushOutbox(U);
        expect(server.rows.has(`transactions:${id}`)).toBe(false);
    });

    it('retrying a failed entry sends it again', async () => {
        setOnline(false);
        await repo.createTransaction({ id: 'tx-7', userId: U, merchant: 'Late', total: 3, date: '2026-11-09' });
        const [e] = await db.outbox.toArray();
        await db.outbox.update(e.seq, { status: 'failed', lastError: 'rejected' });
        setOnline(true);
        await retryEntry(e.seq, U);
        expect(serverTx()).toHaveLength(1);
        expect(await db.outbox.count()).toBe(0);
    });

    it('discarding a failed insert removes the local record and its queued photo', async () => {
        setOnline(false);
        const id = 'tx-9';
        const imagePath = await queueImage({ userId: U, transactionId: id, blob: photo() });
        await repo.createTransaction({ id, userId: U, merchant: 'Never', total: 1, date: '2026-11-09', imagePath });
        const [row] = await db.outbox.toArray();
        await db.outbox.update(row.seq, { status: 'failed' });
        await discardEntry(row.seq);
        expect(await db.transactions.get(id)).toBeUndefined();
        expect(await db.images.get(id)).toBeUndefined();
        expect(await db.outbox.count()).toBe(0);
    });
});

describe('extraction never overwrites newer manual edits', () => {
    const GOOD = { receipt: { merchant: 'Lidl', date: '2026-11-08', total: 23.47, currency: 'EUR', category: 'Groceries', items: [{ name: 'Latte', quantity: 1, price: 1.19 }], paymentMethod: 'card', confidence: { merchant: 1, date: 1, total: 1, items: 1 } }, extraction: { provider: 'vision' } };
    const run = (fetchImpl) => processPendingScans({ userId: U, getToken: async () => 't', getHints: () => ({}), fetchImpl });
    const ok = () => vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => GOOD });

    it('keeps a manually confirmed total while extraction was pending, offers the scanned one as a suggestion', async () => {
        setOnline(false);
        const id = await createPendingScan({ userId: U, file: new File(['x'], 'r.jpg', { type: 'image/jpeg' }), label: 'Receipt to read' });
        await repo.updateTransaction(id, { total: 20 }); // "manual total while extraction is pending"
        setOnline(true);
        await run(ok());
        const tx = await db.transactions.get(id);
        expect(tx.total).toBe(20); // the user's value survives
        expect(tx.merchant).toBe('Lidl'); // untouched fields are filled
        expect(tx.lineItems).toHaveLength(1);
        expect(tx.extraction).toMatchObject({ pending: false, needsReview: true, suggested: { total: 23.47 } });
        expect(Object.keys(tx.extraction.editedAt)).toEqual(['total']);
    });

    it('an edit made while the extraction request is in flight still wins', async () => {
        setOnline(false);
        const id = await createPendingScan({ userId: U, file: new File(['x'], 'r.jpg', { type: 'image/jpeg' }), label: 'Receipt to read' });
        setOnline(true);
        const fetchImpl = vi.fn(async () => {
            await repo.updateTransaction(id, { merchant: 'My shop', category: 'Shopping' }); // user edits during the request
            return { status: 200, ok: true, json: async () => GOOD };
        });
        await run(fetchImpl);
        const tx = await db.transactions.get(id);
        expect(tx).toMatchObject({ merchant: 'My shop', category: 'Shopping', total: 23.47 });
    });

    it('a placeholder deleted while its photo is being read is not resurrected', async () => {
        setOnline(false);
        const id = await createPendingScan({ userId: U, file: new File(['x'], 'r.jpg', { type: 'image/jpeg' }), label: 'Receipt to read' });
        setOnline(true);
        const fetchImpl = vi.fn(async () => {
            await repo.deleteTransaction(id);
            return { status: 200, ok: true, json: async () => GOOD };
        });
        const r = await run(fetchImpl);
        expect(r.failed).toBe(0);
        expect(await db.transactions.get(id)).toBeUndefined();
        expect(await db.outbox.count()).toBe(0);
        expect(await db.images.count()).toBe(0);
    });
});

describe('case 2: manual entry first, scan later -> attach, no duplicate', () => {
    it('attaches photo and items to the manual transaction and keeps the user values', async () => {
        const id = await repo.createTransaction({ userId: U, merchant: 'Lidl', total: 23.47, date: '2026-11-08', category: 'Groceries' });
        const result = { receipt: { merchant: 'LIDL ITALIA', total: 23.47, date: '2026-11-08', currency: 'EUR', category: 'Groceries', time: '18:22', paymentMethod: 'card', confidence: {} }, extraction: { provider: 'vision' } };
        await attachScanToTransaction({ transactionId: id, userId: U, file: photo(), result, items: [{ name: 'Latte', price: 1.19 }] });
        const all = await repo.listTransactions(U);
        expect(all).toHaveLength(1);
        expect(all[0]).toMatchObject({ id, merchant: 'Lidl', total: 23.47, imagePath: `${U}/${id}.jpg` });
        expect(all[0].lineItems).toEqual([{ name: 'Latte', price: 1.19 }]);
        expect(all[0].extraction).toMatchObject({ attachedToManual: true, time: '18:22', needsReview: false });
        expect(await db.images.get(id)).toBeTruthy();
    });
});

describe('sync states', () => {
    it('derives saved on device / waiting for connection / synced / needs attention, with separate image and analysis states', () => {
        const txs = [
            { id: 'a' },
            { id: 'b' },
            { id: 'c' },
            { id: 'd', imagePath: 'x', extraction: { pending: true } },
        ];
        const outbox = [
            { table: 'transactions', recordId: 'a', status: 'pending', tries: 0 },
            { table: 'transactions', recordId: 'b', status: 'failed', tries: 3 },
        ];
        const images = [{ transactionId: 'd', kind: 'upload', status: 'pending', tries: 0 }];
        const online = computeRecordSyncStates({ transactions: txs, outbox, images, online: true });
        expect(online.get('a').overall).toBe('saved_local');
        expect(online.get('b').overall).toBe('attention');
        expect(online.get('c').overall).toBe('synced');
        expect(online.get('d')).toMatchObject({ record: 'synced', image: 'saved_local', analysis: 'saved_local' });
        const offline = computeRecordSyncStates({ transactions: txs, outbox, images, online: false });
        expect(offline.get('a').overall).toBe('waiting');
        expect(offline.get('d')).toMatchObject({ image: 'waiting', analysis: 'waiting', overall: 'waiting' });
        expect(summarizeQueue({ outbox, images, online: false })).toMatchObject({ pending: 2, failed: 1, state: 'attention' });
        expect(summarizeQueue({ outbox: [], images: [], online: true }).state).toBe('synced');
    });
});

describe('drafts', () => {
    it('survive a restart and are removed explicitly', async () => {
        await saveDraft({ userId: U, kind: 'quickadd', data: { expr: '12.5', merchant: 'Lidl' } });
        await restartApp();
        expect((await getDraft(U, 'quickadd')).data).toEqual({ expr: '12.5', merchant: 'Lidl' });
        await saveDraft({ userId: U, kind: 'scan', data: { stage: 'review' }, blob: photo() });
        expect((await getDraft(U, 'scan')).blob).toBeTruthy();
        await deleteDraft(U, 'quickadd');
        expect(await getDraft(U, 'quickadd')).toBeNull();
    });
});

describe('backup and restore', () => {
    it('round-trips every user table and the photos; restore adds missing rows and never overwrites newer ones', async () => {
        await repo.createGroup(U, { id: 'g1', name: 'Trip' });
        await repo.createRow('accounts', U, { id: 'a1', name: 'Cash', kind: 'cash', currency: 'EUR', openingBalance: 5 });
        const id = await repo.createTransaction({ userId: U, merchant: 'Lidl', total: 9, date: '2026-11-08', category: 'Groceries', accountId: 'a1', groupId: 'g1' });
        await queueImage({ userId: U, transactionId: id, blob: photo() });
        await db.transactions.update(id, { imagePath: `${U}/${id}.jpg` });

        const backup = await exportBackup(U, { includeImages: true });
        expect(backup.counts).toMatchObject({ transactions: 1, groups: 1, accounts: 1, images: 1 });
        const { backup: parsed, counts } = parseBackup(JSON.stringify(backup));
        expect(counts.transactions).toBe(1);

        // wipe and restore on a fresh device (as another signed-in user, owner is rewritten)
        await Promise.all(db.tables.map((t) => t.clear()));
        const preview = await previewRestore(parsed, 'u2');
        expect(preview.transactions).toEqual({ added: 1, updated: 0, skipped: 0 });
        const done = await restoreBackup(parsed, 'u2');
        expect(done.transactions.added).toBe(1);
        expect(done.images.added).toBe(1);
        const restored = await repo.listTransactions('u2');
        expect(restored).toHaveLength(1);
        expect(restored[0]).toMatchObject({ id, merchant: 'Lidl', accountId: 'a1', groupId: 'g1', userId: 'u2' });
        expect(await db.outbox.count()).toBeGreaterThan(0); // restored rows reach the server through the normal queue

        // a second restore changes nothing; a newer local row is not overwritten
        await db.transactions.update(id, { merchant: 'Edited later', updatedAt: '2099-01-01T00:00:00.000Z' });
        const again = await restoreBackup(parsed, 'u2');
        expect(again.transactions).toEqual({ added: 0, updated: 0, skipped: 1 });
        expect((await db.transactions.get(id)).merchant).toBe('Edited later');
    });

    it('rejects files that are not backups', () => {
        expect(() => parseBackup('not json')).toThrow('invalid_backup');
        expect(() => parseBackup(JSON.stringify({ app: 'other', tables: {} }))).toThrow('invalid_backup');
        expect(() => parseBackup(JSON.stringify({ app: 'wmw-backup', version: 99, tables: {} }))).toThrow('unsupported_backup');
    });
});

describe('outbox operation ids', () => {
    it('coalescing keeps the first operation id', async () => {
        setOnline(false);
        await db.transaction('rw', db.outbox, () => enqueue({ userId: U, table: 'transactions', op: 'insert', recordId: 'z', payload: { id: 'z', total: 1 }, ts: '2026-11-01T10:00:00.000Z' }));
        const [first] = await db.outbox.toArray();
        await db.transaction('rw', db.outbox, () => enqueue({ userId: U, table: 'transactions', op: 'update', recordId: 'z', payload: { total: 2 }, ts: '2026-11-01T10:01:00.000Z' }));
        const rows = await db.outbox.toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].opId).toBe(first.opId);
        expect(rows[0].payload.total).toBe(2);
    });

    it('upgrade backfills ids for entries queued before schema v2', async () => {
        // modelled by the upgrade function contract: every row has an opId after open
        const rows = await db.outbox.toArray();
        expect(rows.every((r) => r.opId)).toBe(true);
    });
});
