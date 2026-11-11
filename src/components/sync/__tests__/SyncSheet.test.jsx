import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent } from '@testing-library/react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));

import SyncChip from '../SyncChip';
import RecordSyncBadge from '../RecordSyncBadge';
import { db, openDb } from '../../../data/db';
import { queryClient } from '../../../data/queryClient';
import { useAppStore } from '../../../store/appStore';
import { createTransaction } from '../../../data/repo';
import { refreshOutboxCounts } from '../../../data/sync';

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    queryClient.clear();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    useAppStore.setState({ currentUser: { userId: 'u1', email: 'a@b.c' }, isAuthenticated: true, languageCode: 'en', toast: null });
});

async function mount(ui) {
    document.body.replaceChildren();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
    await act(async () => new Promise((r) => setTimeout(r, 250)));
    return root;
}

describe('sync chip and "Needs attention"', () => {
    it('stays quiet when everything is synced', async () => {
        const root = await mount(<SyncChip />);
        expect(document.querySelector('[data-testid="sync-chip"]')).toBeNull();
        await act(async () => root.unmount());
    });

    it('lists a failed change with Retry and Discard; discarding a failed insert removes the record', async () => {
        const id = await createTransaction({ userId: 'u1', merchant: 'Rejected shop', total: 12, date: '2026-11-09' });
        const [entry] = await db.outbox.toArray();
        await db.outbox.update(entry.seq, { status: 'failed', lastError: 'new row violates row-level security policy' });
        await refreshOutboxCounts();
        const root = await mount(<SyncChip />);
        const chip = document.querySelector('[data-testid="sync-chip"]');
        expect(chip.textContent).toContain('1 need attention');
        await act(async () => fireEvent.click(chip));
        for (let i = 0; i < 40 && !document.querySelector('[data-testid="attention-entry"]')?.textContent.includes('Rejected shop'); i++) {
            await act(async () => new Promise((r) => setTimeout(r, 50))); // the transaction list loads from the mirror
        }
        const item = document.querySelector('[data-testid="attention-entry"]');
        expect(item.textContent).toContain('Rejected shop');
        expect(item.textContent).toContain('row-level security');
        const buttons = [...item.querySelectorAll('button')].map((b) => b.textContent);
        expect(buttons).toEqual(['Retry', 'Discard']);
        await act(async () => fireEvent.click([...item.querySelectorAll('button')].find((b) => b.textContent === 'Discard')));
        await act(async () => new Promise((r) => setTimeout(r, 100)));
        expect(await db.outbox.count()).toBe(0);
        expect(await db.transactions.get(id)).toBeUndefined();
        await act(async () => root.unmount());
    });

    it('offline: the chip says so and counts what is waiting', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        await createTransaction({ userId: 'u1', merchant: 'A', total: 1, date: '2026-11-09' });
        await refreshOutboxCounts();
        const root = await mount(<SyncChip />);
        expect(document.querySelector('[data-testid="sync-chip"]').textContent).toContain('Offline · 1 waiting');
        await act(async () => root.unmount());
    });

    it('badge labels the four states', async () => {
        const root = await mount(
            <>
                {['saved_local', 'waiting', 'synced', 'attention'].map((s) => (
                    <RecordSyncBadge key={s} state={s} />
                ))}
            </>
        );
        const text = document.body.textContent;
        for (const label of ['Saved on this device', 'Waiting for connection', 'Synced', 'Needs attention']) expect(text).toContain(label);
        await act(async () => root.unmount());
    });
});
