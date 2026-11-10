import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../api', () => ({
    isConfigured: vi.fn(() => true),
    isMissingTableError: vi.fn(() => false),
    isTransientError: vi.fn(() => false),
    insert: vi.fn(async (_t, rec) => rec),
    update: vi.fn(async (_t, id, patch) => ({ id, ...patch })),
    upsert: vi.fn(async (_t, rec) => rec),
    remove: vi.fn(),
    removeGroup: vi.fn(),
    fetchUpdatedAt: vi.fn(async () => '2000-01-01T00:00:00.000Z'),
    fetchSince: vi.fn(async () => []),
    fetchIds: vi.fn(async () => []),
}));

import { db, openDb } from '../db';
import { queryClient } from '../queryClient';
import { useAppStore } from '../../store/appStore';
import { __resetSyncForTests } from '../sync';
import { useTransactions, useCreateTransaction, useUpdateTransaction, useDeleteTransaction, useSettings, useSaveSettings } from '../hooks';

let api;
function Probe() {
    const { transactions, loading } = useTransactions();
    const { defaultCurrency } = useSettings();
    api = {
        transactions,
        loading,
        defaultCurrency,
        create: useCreateTransaction(),
        update: useUpdateTransaction(),
        remove: useDeleteTransaction(),
        saveSettings: useSaveSettings(),
    };
    return null;
}

let root;
beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    __resetSyncForTests();
    queryClient.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    useAppStore.setState({ currentUser: { userId: 'u1', email: 'a@b.c' }, isAuthenticated: true });
    const el = document.createElement('div');
    root = createRoot(el);
    await act(async () => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <Probe />
            </QueryClientProvider>
        );
    });
});

describe('data hooks (offline)', () => {
    it('creating, updating and deleting transactions updates the queries without refresh events', async () => {
        expect(api.transactions).toEqual([]);

        let id;
        await act(async () => {
            id = await api.create({ userId: 'u1', merchant: 'Lidl', total: 12.5, date: '2026-11-08' });
        });
        expect(api.transactions.map((r) => r.merchant)).toEqual(['Lidl']);

        await act(async () => {
            await api.update(id, { isPinned: true });
        });
        expect(api.transactions[0].isPinned).toBe(true);

        await act(async () => {
            await api.remove(id);
        });
        expect(api.transactions).toEqual([]);
    });

    it('exposes settings with defaults and merges saves', async () => {
        expect(api.defaultCurrency).toBe('EUR');
        await act(async () => {
            await api.saveSettings({ defaultCurrency: 'USD' });
        });
        expect(api.defaultCurrency).toBe('USD');
    });
});
