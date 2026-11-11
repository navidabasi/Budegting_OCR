import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../api', () => ({
    isConfigured: vi.fn(() => true),
    isMissingTableError: vi.fn((e) => e?.code === '42P01'),
    isTransientError: vi.fn((e) => e?.status >= 500 || e?.message === 'Failed to fetch'),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
    removeGroup: vi.fn(),
    fetchUpdatedAt: vi.fn(),
    fetchOne: vi.fn(async () => null),
    fetchSince: vi.fn(async () => []),
    fetchIds: vi.fn(async () => []),
    fetchPage: vi.fn(async () => ({ rows: [], next: null })),
    PULL_PAGE: 50,
}));
vi.mock('../queryClient', () => ({ notifyDataChanged: vi.fn(), queryClient: {} }));

import * as api from '../api';
import { db, openDb } from '../db';
import { enqueue, flushOutbox, pullTable, reconcileTable, syncNow, __resetSyncForTests } from '../sync';

const USER = 'user-1';
const T0 = '2026-11-01T10:00:00.000Z';
const T1 = '2026-11-01T11:00:00.000Z';
const T2 = '2026-11-01T12:00:00.000Z';

const queue = (entry) =>
    db.transaction('rw', db.outbox, () => enqueue({ userId: USER, ...entry }));
const outbox = () => db.outbox.orderBy('seq').toArray();

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    __resetSyncForTests();
    vi.clearAllMocks();
    api.isConfigured.mockReturnValue(true);
    api.insert.mockImplementation(async (_t, rec) => ({ ...rec, updatedAt: '2026-11-01T20:00:00.000Z' }));
    api.update.mockImplementation(async (_t, id, patch) => ({ id, ...patch, updatedAt: '2026-11-01T20:00:01.000Z' }));
    api.upsert.mockImplementation(async (_t, rec) => ({ ...rec, updatedAt: '2026-11-01T20:00:02.000Z' }));
    api.fetchUpdatedAt.mockResolvedValue(T0);
    api.fetchSince.mockResolvedValue([]);
    api.fetchIds.mockResolvedValue([]);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('outbox enqueue + flush', () => {
    it('flushes entries FIFO and empties the outbox', async () => {
        await queue({ table: 'transactions', op: 'insert', recordId: 'a', payload: { id: 'a', total: 1 }, ts: T1 });
        await queue({ table: 'groups', op: 'insert', recordId: 'g', payload: { id: 'g', name: 'Trip' }, ts: T1 });
        await queue({ table: 'transactions', op: 'insert', recordId: 'b', payload: { id: 'b', total: 2 }, ts: T1 });

        const res = await flushOutbox(USER);

        expect(res.pushed).toBe(3);
        expect(api.insert.mock.calls.map((c) => [c[0], c[1].id])).toEqual([
            ['transactions', 'a'],
            ['groups', 'g'],
            ['transactions', 'b'],
        ]);
        expect(await outbox()).toHaveLength(0);
    });

    it('sends deletes (groups through removeGroup)', async () => {
        await queue({ table: 'transactions', op: 'delete', recordId: 'a', ts: T1 });
        await queue({ table: 'groups', op: 'delete', recordId: 'g', ts: T1 });
        await flushOutbox(USER);
        expect(api.remove).toHaveBeenCalledWith('transactions', 'a');
        expect(api.removeGroup).toHaveBeenCalledWith('g');
    });

    it('does nothing while offline and keeps entries queued', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        await queue({ table: 'transactions', op: 'insert', recordId: 'a', payload: { id: 'a' }, ts: T1 });
        const res = await flushOutbox(USER);
        expect(res.skipped).toBe(true);
        expect(api.insert).not.toHaveBeenCalled();
        expect(await outbox()).toHaveLength(1);
    });

    it('stops at a transient failure, keeps order, and retries later', async () => {
        await queue({ table: 'transactions', op: 'insert', recordId: 'a', payload: { id: 'a' }, ts: T1 });
        await queue({ table: 'transactions', op: 'insert', recordId: 'b', payload: { id: 'b' }, ts: T1 });
        api.insert.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { status: 0 }));

        const first = await flushOutbox(USER);
        expect(first.pushed).toBe(0);
        expect(first.errors).toHaveLength(1);
        let rows = await outbox();
        expect(rows.map((r) => r.recordId)).toEqual(['a', 'b']);
        expect(rows[0].tries).toBe(1);
        expect(api.insert).toHaveBeenCalledTimes(1); // b was not attempted past the failure

        const second = await flushOutbox(USER);
        expect(second.pushed).toBe(2);
        expect(await outbox()).toHaveLength(0);
    });

    it('parks permanent failures without blocking the queue', async () => {
        await queue({ table: 'transactions', op: 'insert', recordId: 'bad', payload: { id: 'bad' }, ts: T1 });
        await queue({ table: 'transactions', op: 'insert', recordId: 'ok', payload: { id: 'ok' }, ts: T1 });
        api.insert.mockRejectedValueOnce(Object.assign(new Error('violates check constraint'), { code: '23514', status: 400 }));

        const res = await flushOutbox(USER);
        expect(res.pushed).toBe(1);
        const rows = await outbox();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ recordId: 'bad', status: 'failed' });
    });

    it('only flushes entries of the given user', async () => {
        await db.transaction('rw', db.outbox, () =>
            enqueue({ userId: 'other', table: 'transactions', op: 'insert', recordId: 'x', payload: { id: 'x' }, ts: T1 })
        );
        await queue({ table: 'transactions', op: 'insert', recordId: 'a', payload: { id: 'a' }, ts: T1 });
        await flushOutbox(USER);
        expect(api.insert).toHaveBeenCalledTimes(1);
        expect((await outbox()).map((r) => r.recordId)).toEqual(['x']);
    });
});

describe('conflict rule: server updated_at wins unless the outbox entry is newer', () => {
    it('applies an update when the entry is newer than the server row', async () => {
        api.fetchUpdatedAt.mockResolvedValue(T0);
        await queue({ table: 'transactions', op: 'update', recordId: 'a', payload: { merchant: 'Lidl' }, ts: T1 });
        const res = await flushOutbox(USER);
        expect(api.update).toHaveBeenCalledWith('transactions', 'a', { merchant: 'Lidl' });
        expect(res.pushed).toBe(1);
        expect(res.conflicts).toHaveLength(0);
    });

    it('drops an update when the server row is newer', async () => {
        api.fetchUpdatedAt.mockResolvedValue(T2);
        await queue({ table: 'transactions', op: 'update', recordId: 'a', payload: { merchant: 'Lidl' }, ts: T1 });
        const res = await flushOutbox(USER);
        expect(api.update).not.toHaveBeenCalled();
        expect(res.pushed).toBe(0);
        expect(res.conflicts).toEqual([{ table: 'transactions', id: 'a', reason: 'server-newer' }]);
        expect(await outbox()).toHaveLength(0);
    });

    it('drops an update for a row deleted on the server', async () => {
        api.fetchUpdatedAt.mockResolvedValue(null);
        await queue({ table: 'transactions', op: 'update', recordId: 'a', payload: { merchant: 'Lidl' }, ts: T1 });
        const res = await flushOutbox(USER);
        expect(api.update).not.toHaveBeenCalled();
        expect(res.conflicts[0].reason).toBe('deleted-on-server');
    });

    it('upserts a single-row table when the server row does not exist yet', async () => {
        api.fetchUpdatedAt.mockResolvedValue(null);
        await queue({ table: 'settings', op: 'upsert', recordId: USER, payload: { userId: USER, defaultCurrency: 'USD' }, ts: T1 });
        await flushOutbox(USER);
        expect(api.upsert).toHaveBeenCalledWith('settings', { userId: USER, defaultCurrency: 'USD' });
    });

    it('does not treat our own earlier write in the same flush as a conflict', async () => {
        // two separate updates to the same record that could not be coalesced (another entry in between)
        await queue({ table: 'transactions', op: 'update', recordId: 'a', payload: { merchant: 'A' }, ts: T1 });
        await queue({ table: 'groups', op: 'insert', recordId: 'g', payload: { id: 'g' }, ts: T1 });
        await queue({ table: 'transactions', op: 'update', recordId: 'a', payload: { notes: 'n' }, ts: T1 });
        api.fetchUpdatedAt.mockResolvedValue(T0);
        api.update
            .mockResolvedValueOnce({ id: 'a', updatedAt: T2 }) // server stamps its own newer time
            .mockResolvedValueOnce({ id: 'a', updatedAt: T2 });
        // after the first update the server row reads as T2 (> entry ts) - must still apply the second
        api.fetchUpdatedAt.mockResolvedValueOnce(T0).mockResolvedValue(T2);

        const res = await flushOutbox(USER);
        expect(api.update).toHaveBeenCalledTimes(2);
        expect(res.conflicts).toHaveLength(0);
    });

    it('pull keeps a local record whose outbox entry is newer than the server row', async () => {
        await db.transactions.put({ id: 'a', userId: USER, merchant: 'Local', updatedAt: T2 });
        await queue({ table: 'transactions', op: 'update', recordId: 'a', payload: { merchant: 'Local' }, ts: T2 });
        api.fetchSince.mockResolvedValue([{ id: 'a', userId: USER, merchant: 'Server', updatedAt: T1 }]);

        await pullTable(USER, 'transactions');

        expect((await db.transactions.get('a')).merchant).toBe('Local');
        expect(await outbox()).toHaveLength(1);
    });

    it('pull lets a newer server row win and discards the stale outbox entry', async () => {
        await db.transactions.put({ id: 'a', userId: USER, merchant: 'Local', updatedAt: T0 });
        await queue({ table: 'transactions', op: 'update', recordId: 'a', payload: { merchant: 'Local' }, ts: T1 });
        api.fetchSince.mockResolvedValue([{ id: 'a', userId: USER, merchant: 'Server', updatedAt: T2 }]);

        const res = await pullTable(USER, 'transactions');

        expect((await db.transactions.get('a')).merchant).toBe('Server');
        expect(await outbox()).toHaveLength(0);
        expect(res.conflicts).toHaveLength(1);
    });
});

describe('coalescing', () => {
    it('merges consecutive updates and updates into a pending insert', async () => {
        await queue({ table: 'transactions', op: 'insert', recordId: 'a', payload: { id: 'a', total: 1 }, ts: T0 });
        await queue({ table: 'transactions', op: 'update', recordId: 'a', payload: { total: 2 }, ts: T1 });
        await queue({ table: 'transactions', op: 'update', recordId: 'a', payload: { notes: 'x' }, ts: T2 });
        const rows = await outbox();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ op: 'insert', payload: { id: 'a', total: 2, notes: 'x' }, ts: T2 });
    });

    it('drops insert+delete of a never-sent record', async () => {
        await queue({ table: 'transactions', op: 'insert', recordId: 'a', payload: { id: 'a' }, ts: T0 });
        await queue({ table: 'transactions', op: 'delete', recordId: 'a', ts: T1 });
        expect(await outbox()).toHaveLength(0);
    });

    it('keeps only the delete when a server-known record was edited then deleted', async () => {
        await queue({ table: 'transactions', op: 'update', recordId: 'a', payload: { total: 2 }, ts: T0 });
        await queue({ table: 'transactions', op: 'delete', recordId: 'a', ts: T1 });
        const rows = await outbox();
        expect(rows.map((r) => r.op)).toEqual(['delete']);
    });
});

describe('optional (v13) tables', () => {
    it('keeps queued writes when the remote table does not exist yet', async () => {
        await queue({ table: 'accounts', op: 'insert', recordId: 'acc', payload: { id: 'acc' }, ts: T1 });
        await queue({ table: 'transactions', op: 'insert', recordId: 't', payload: { id: 't' }, ts: T1 });
        api.insert.mockImplementation(async (table, rec) => {
            if (table === 'accounts') throw Object.assign(new Error('relation "accounts" does not exist'), { code: '42P01' });
            return rec;
        });
        const res = await flushOutbox(USER);
        expect(res.pushed).toBe(1);
        expect((await outbox()).map((r) => r.table)).toEqual(['accounts']);
    });

    it('discards queued layout writes when user_layouts is missing (local only)', async () => {
        await queue({ table: 'layouts', op: 'upsert', recordId: USER, payload: { userId: USER, layout: {} }, ts: T1 });
        api.fetchUpdatedAt.mockRejectedValue(Object.assign(new Error('missing'), { code: '42P01' }));
        await flushOutbox(USER);
        expect(await outbox()).toHaveLength(0);
    });
});

describe('pull + reconcile', () => {
    it('stores rows, reports new vs updated and advances the cursor', async () => {
        await db.transactions.put({ id: 'old', userId: USER, merchant: 'x', updatedAt: T0 });
        api.fetchSince.mockResolvedValue([
            { id: 'old', userId: USER, merchant: 'y', updatedAt: T1 },
            { id: 'new', userId: USER, merchant: 'z', updatedAt: T2 },
        ]);
        const res = await pullTable(USER, 'transactions');
        expect(res).toMatchObject({ downloaded: 1, updated: 1 });
        expect(api.fetchSince).toHaveBeenCalledWith('transactions', USER, null);

        await pullTable(USER, 'transactions');
        expect(api.fetchSince).toHaveBeenLastCalledWith('transactions', USER, T2);
    });

    it('removes rows deleted on the server but not rows with a pending insert', async () => {
        await db.transactions.bulkPut([
            { id: 'keep', userId: USER },
            { id: 'gone', userId: USER },
            { id: 'pending', userId: USER },
        ]);
        await queue({ table: 'transactions', op: 'insert', recordId: 'pending', payload: { id: 'pending' }, ts: T1 });
        api.fetchIds.mockResolvedValue(['keep']);
        const deleted = await reconcileTable(USER, 'transactions');
        expect(deleted).toBe(1);
        expect((await db.transactions.toArray()).map((r) => r.id).sort()).toEqual(['keep', 'pending']);
    });

    it('syncNow pushes first, then pulls, and returns a summary', async () => {
        await queue({ table: 'transactions', op: 'insert', recordId: 'a', payload: { id: 'a' }, ts: T1 });
        api.fetchSince.mockResolvedValue([]);
        const res = await syncNow(USER, { reason: 'test' });
        expect(res).toMatchObject({ uploaded: 1, downloaded: 0, errors: [] });
        const calls = [...api.insert.mock.invocationCallOrder, ...api.fetchSince.mock.invocationCallOrder];
        expect(api.insert.mock.invocationCallOrder[0]).toBeLessThan(api.fetchSince.mock.invocationCallOrder[0]);
        expect(calls.length).toBeGreaterThan(1);
    });

    it('syncNow is skipped while offline', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        const res = await syncNow(USER);
        expect(res.skipped).toBe('offline');
        expect(api.fetchSince).not.toHaveBeenCalled();
    });
});
