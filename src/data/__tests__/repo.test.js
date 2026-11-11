import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../api', () => ({
    isConfigured: vi.fn(() => true),
    isMissingTableError: vi.fn(() => false),
    isTransientError: vi.fn((e) => e?.message === 'Failed to fetch'),
    insert: vi.fn(async (_t, rec) => rec),
    update: vi.fn(async (_t, id, patch) => ({ id, ...patch })),
    upsert: vi.fn(async (_t, rec) => rec),
    remove: vi.fn(),
    removeGroup: vi.fn(),
    fetchUpdatedAt: vi.fn(async () => '2000-01-01T00:00:00.000Z'),
    fetchOne: vi.fn(async () => null),
    fetchSince: vi.fn(async () => []),
    fetchIds: vi.fn(async () => []),
    fetchPage: vi.fn(async () => ({ rows: [], next: null })),
    PULL_PAGE: 50,
}));
vi.mock('../queryClient', () => ({ notifyDataChanged: vi.fn(), queryClient: {} }));

import * as api from '../api';
import { db, openDb } from '../db';
import { __resetSyncForTests, flushOutbox } from '../sync';
import * as repo from '../repo';

const USER = 'u1';
const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    __resetSyncForTests();
    vi.clearAllMocks();
    setOnline(true);
});

describe('offline writes', () => {
    it('adds 3 transactions to the mirror and outbox, then flushes them on reconnect', async () => {
        setOnline(false);
        for (const merchant of ['A', 'B', 'C']) {
            await repo.createTransaction({ userId: USER, merchant, total: 1, date: '2026-11-01' });
        }
        expect(await repo.listTransactions(USER)).toHaveLength(3);
        expect(await db.outbox.count()).toBe(3);
        expect(api.insert).not.toHaveBeenCalled();

        setOnline(true);
        const res = await flushOutbox(USER);
        expect(res.pushed).toBe(3);
        expect(api.insert).toHaveBeenCalledTimes(3);
        expect(await db.outbox.count()).toBe(0);
        expect(await db.transactions.count()).toBe(3);
    });

    it('flushes immediately when online', async () => {
        await repo.createTransaction({ userId: USER, merchant: 'A', total: 1, date: '2026-11-01' });
        await settle();
        expect(api.insert).toHaveBeenCalledTimes(1);
        expect(await db.outbox.count()).toBe(0);
    });
});

describe('transactions', () => {
    it('updates, filters by month and deletes', async () => {
        setOnline(false);
        const id = await repo.createTransaction({ userId: USER, merchant: 'A', total: 5, date: '2026-10-15' });
        await repo.createTransaction({ userId: USER, merchant: 'B', total: 7, date: '2026-11-02' });
        await repo.updateTransaction(id, { isPinned: true, total: 6 });
        expect((await repo.getTransaction(id)).isPinned).toBe(true);
        expect((await repo.listTransactions(USER, { month: '2026-10' })).map((r) => r.merchant)).toEqual(['A']);
        await repo.deleteTransaction(id);
        expect(await repo.getTransaction(id)).toBeNull();
        // insert+update merged then deleted before reaching the server: only B's insert remains
        expect((await db.outbox.toArray()).map((e) => e.recordId)).toHaveLength(1);
    });

    it('marks a tracked one-off transaction as done', async () => {
        setOnline(false);
        const id = await repo.createTransaction({
            userId: USER, merchant: 'Rent', total: 500, date: '2026-11-01',
            trackingData: { isTracked: true, status: 'open' },
        });
        const done = await repo.markTransactionDone(id);
        expect(done.trackingData.status).toBe('done');
    });

    it('marks a recurring transaction as done by creating a completed copy and rolling the date', async () => {
        setOnline(false);
        const id = await repo.createTransaction({
            userId: USER, merchant: 'Netflix', total: 10, date: '2026-11-01',
            recurringData: { isActive: true, frequency: 'monthly' },
            trackingData: { isTracked: true, status: 'open' },
        });
        const updated = await repo.markTransactionDone(id);
        expect(updated.date).toBe('2026-12-01');
        expect(updated.trackingData.status).toBe('open');
        const all = await repo.listTransactions(USER);
        expect(all).toHaveLength(2);
        expect(all.find((r) => r.id !== id).trackingData.status).toBe('done');
    });

    it('seeds and clears demo data', async () => {
        setOnline(false);
        expect(await repo.seedDemoData(USER)).toEqual({ importedCount: 5, alreadyExists: false });
        expect((await repo.seedDemoData(USER)).alreadyExists).toBe(true);
        expect(await repo.countDemoTransactions(USER)).toBe(5);
        expect(await repo.clearDemoData(USER)).toBe(5);
        expect(await repo.countDemoTransactions(USER)).toBe(0);
    });
});

describe('groups and categories', () => {
    it('moves receipts to the parent group (or ungroups) when a group is deleted', async () => {
        setOnline(false);
        const parent = await repo.createGroup(USER, { name: 'Parent' });
        const child = await repo.createGroup(USER, { name: 'Child', parentGroupId: parent.id });
        const solo = await repo.createGroup(USER, { name: 'Solo' });
        const a = await repo.createTransaction({ userId: USER, merchant: 'A', total: 1, date: '2026-11-01', groupId: child.id, groupName: 'Child' });
        const b = await repo.createTransaction({ userId: USER, merchant: 'B', total: 1, date: '2026-11-01', groupId: solo.id, groupName: 'Solo', groupTags: ['x'] });

        await repo.deleteGroup(child.id);
        await repo.deleteGroup(solo.id);

        expect(await repo.getTransaction(a)).toMatchObject({ groupId: parent.id, groupName: 'Parent' });
        expect(await repo.getTransaction(b)).toMatchObject({ groupId: null, groupName: null, groupTags: [] });
    });

    it('keeps category names unique per user', async () => {
        setOnline(false);
        const c1 = await repo.createCategory(USER, { name: 'Pets', color: '#111111' });
        const c2 = await repo.createCategory(USER, { name: 'Pets', color: '#222222' });
        expect(c2.id).toBe(c1.id);
        await repo.updateCategory(c1.id, { color: '#333333' });
        expect((await repo.listCategories(USER))[0].color).toBe('#333333');
    });
});

describe('settings and layout', () => {
    it('merges settings patches (OCR key, currency, language, notification prefs)', async () => {
        setOnline(false);
        await repo.saveSettings(USER, { ocrApiKey: 'key' });
        await repo.saveSettings(USER, { defaultCurrency: 'USD' });
        await repo.saveSettings(USER, { languageCode: 'it', notificationPreferences: { enabled: true } });
        expect(await repo.getSettings(USER)).toMatchObject({
            ocrApiKey: 'key', defaultCurrency: 'USD', languageCode: 'it', notificationPreferences: { enabled: true },
        });
        expect(await db.outbox.count()).toBe(1); // coalesced into one upsert
    });

    it('saves the dashboard layout', async () => {
        setOnline(false);
        await repo.saveLayout(USER, { widgets: ['a'], enabled: ['a'] });
        expect((await repo.getLayout(USER)).layout).toEqual({ widgets: ['a'], enabled: ['a'] });
    });
});

describe('v14 category read mapping', () => {
    it('shows pre-deploy category names with the new names without rewriting the mirror', async () => {
        const now = new Date().toISOString();
        await db.transactions.put({ id: 'x1', userId: USER, merchant: 'Old', total: 5, currency: 'EUR', date: '2026-11-01', category: 'Restaurant', lineItems: [{ name: 'a', price: 5, category: 'Gas' }], createdAt: now, updatedAt: now });
        await db.categories.bulkPut([
            { id: 'c1', userId: USER, name: 'Healthcare', color: '#111', createdAt: now, updatedAt: now },
            { id: 'c2', userId: USER, name: 'Stocks', color: '#222', createdAt: now, updatedAt: now },
        ]);
        const [tx] = await repo.listTransactions(USER);
        expect(tx.category).toBe('Dining');
        expect(tx.lineItems[0].category).toBe('Fuel');
        expect((await repo.getTransaction('x1')).category).toBe('Dining');
        expect((await db.transactions.get('x1')).category).toBe('Restaurant');
        expect((await repo.listCategories(USER)).map((c) => c.name)).toEqual(['Health', 'Stocks']);
    });
});

describe('base-currency amounts at write time (P4-T2)', () => {
    const fx = async () => (await import('../../services/exchangeRateService'));
    beforeEach(async () => {
        (await fx()).__clearRateCache();
        await repo.saveSettings(USER, { defaultCurrency: 'EUR' });
    });

    it('stores amountBase/baseCurrency/exchangeRate on create (same currency and cached foreign rate)', async () => {
        const { __clearRateCache } = await fx();
        __clearRateCache();
        localStorage.setItem(`wmw.fx.${(await fx()).todayKey()}.USD`, JSON.stringify({ EUR: 0.5 }));
        const a = await repo.createTransaction({ userId: USER, merchant: 'A', total: 10, date: '2026-11-01' });
        const b = await repo.createTransaction({ userId: USER, merchant: 'B', total: 10, currency: 'USD', date: '2026-11-01' });
        expect(await repo.getTransaction(a)).toMatchObject({ amountBase: 10, baseCurrency: 'EUR', exchangeRate: 1 });
        expect(await repo.getTransaction(b)).toMatchObject({ amountBase: 5, baseCurrency: 'EUR', exchangeRate: 0.5 });
    });

    it('offline with no rate stores null, then fillMissingBaseAmounts fills it after the rate is known', async () => {
        setOnline(false);
        const id = await repo.createTransaction({ userId: USER, merchant: 'C', total: 20, currency: 'GBP', date: '2026-11-01' });
        const tx = await repo.getTransaction(id);
        expect(tx.amountBase ?? null).toBeNull();
        expect(await repo.fillMissingBaseAmounts(USER)).toBe(0);
        localStorage.setItem(`wmw.fx.${(await fx()).todayKey()}.GBP`, JSON.stringify({ EUR: 1.2 }));
        expect(await repo.fillMissingBaseAmounts(USER)).toBe(1);
        expect(await repo.getTransaction(id)).toMatchObject({ amountBase: 24, baseCurrency: 'EUR', exchangeRate: 1.2 });
    });

    it('editing the total or currency recomputes the base amount; other edits keep it', async () => {
        const id = await repo.createTransaction({ userId: USER, merchant: 'D', total: 10, date: '2026-11-01' });
        await repo.updateTransaction(id, { total: 15 });
        expect((await repo.getTransaction(id)).amountBase).toBe(15);
        await repo.updateTransaction(id, { notes: 'x' });
        expect((await repo.getTransaction(id)).amountBase).toBe(15);
    });

    it('recalculateBaseAmounts follows a changed base currency and skips rows without a rate', async () => {
        const id = await repo.createTransaction({ userId: USER, merchant: 'E', total: 10, date: '2026-11-01' });
        await repo.saveSettings(USER, { defaultCurrency: 'USD' });
        setOnline(false);
        let res = await repo.recalculateBaseAmounts(USER);
        expect(res).toEqual({ updated: 0, skipped: 1 });
        localStorage.setItem(`wmw.fx.${(await fx()).todayKey()}.EUR`, JSON.stringify({ USD: 1.1 }));
        res = await repo.recalculateBaseAmounts(USER);
        expect(res.updated).toBe(1);
        expect(await repo.getTransaction(id)).toMatchObject({ amountBase: 11, baseCurrency: 'USD' });
    });
});
