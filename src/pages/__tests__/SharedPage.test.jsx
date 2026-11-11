import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent } from '@testing-library/react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));

import SharedPage from '../SharedPage';
import SplitSheet from '../../components/receipts/SplitSheet';
import { db, openDb } from '../../data/db';
import { queryClient } from '../../data/queryClient';
import { useAppStore } from '../../store/appStore';
import { createRow, createTransaction, listTransactions, saveLayout, saveSettings } from '../../data/repo';
import { buildSplit } from '../../utils/splits';

const U = 'u1';
beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    queryClient.clear();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    useAppStore.setState({ currentUser: { userId: U }, isAuthenticated: true, languageCode: 'en', toast: null });
});
async function mount(ui) {
    document.body.replaceChildren();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/shared']}><Routes><Route path="/shared" element={ui} /></Routes></MemoryRouter></QueryClientProvider>));
    return root;
}
const until = async (fn) => {
    for (let i = 0; i < 40 && !fn(); i++) await act(async () => new Promise((r) => setTimeout(r, 40)));
    return fn();
};

describe('Shared page', () => {
    it('shows who owes me, records a settlement as a transfer (not spending) and squares the balance', async () => {
        await saveSettings(U, { defaultCurrency: 'EUR', languageCode: 'en' });
        await saveLayout(U, { prefs: { people: [{ id: 'marta', name: 'Marta' }] } });
        const acc = await createRow('accounts', U, { name: 'Revolut', kind: 'spending', currency: 'EUR', openingBalance: 100 });
        await createTransaction({ userId: U, merchant: 'Dinner', total: 60, date: '2026-11-02', category: 'Dining', accountId: acc.id, splitData: buildSplit({ total: 60, participants: [{ id: 'me', name: 'Me' }, { id: 'marta', name: 'Marta' }] }).split });
        const root = await mount(<SharedPage />);
        expect(await until(() => document.querySelector('[data-testid="person-row"]'))).toBeTruthy();
        expect(document.querySelector('[data-testid="owed-to-me"]').textContent).toMatch(/30[,.]00/);
        expect(document.querySelector('[data-testid="person-row"]').textContent).toContain('owes you');

        await act(async () => fireEvent.click(document.querySelector('[data-testid="person-row"]')));
        await act(async () => fireEvent.click(document.querySelector('[data-testid="record-settlement"]')));
        await act(async () => fireEvent.click(document.querySelector('[data-testid="settle-save"]')));
        await until(() => document.querySelector('[data-testid="person-row"]')?.textContent.includes('all square'));
        const all = await listTransactions(U);
        const settlement = all.find((t) => t.transactionType === 'transfer');
        expect(settlement).toMatchObject({ total: 30, accountId: acc.id, splitData: { kind: 'settlement', direction: 'received', personId: 'marta', settles: [all.find((t) => t.merchant === 'Dinner').id] } });
        expect(document.querySelector('[data-testid="person-row"]').textContent).toContain('all square');
        await act(async () => root.unmount());
    });
});

describe('SplitSheet', () => {
    it('shows exact shares and names who gets the leftover cent; saves the v2 shape', async () => {
        await saveLayout(U, { prefs: { people: [{ id: 'marta', name: 'Marta' }, { id: 'luca', name: 'Luca' }] } });
        const onSave = vi.fn();
        const root = await mount(<SplitSheet open total={10} currency="EUR" items={[]} value={null} onSave={onSave} onClose={() => {}} />);
        await until(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Marta'));
        for (const n of ['Marta', 'Luca']) await act(async () => fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === n)));
        expect(document.querySelector('[data-testid="split-preview"]').textContent).toMatch(/3[,.]34/);
        expect(document.querySelector('[data-testid="rounding-note"]').textContent).toContain('Me');
        await act(async () => fireEvent.click(document.querySelector('[data-testid="split-save"]')));
        expect(onSave.mock.calls[0][0]).toMatchObject({ v: 2, payer: 'me', method: 'equal', shares: { me: 334, marta: 333, luca: 333 } });
        await act(async () => root.unmount());
    });
});
