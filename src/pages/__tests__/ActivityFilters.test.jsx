import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent } from '@testing-library/react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));

import ActivityPage from '../ActivityPage';
import { db, openDb } from '../../data/db';
import { queryClient } from '../../data/queryClient';
import { useAppStore } from '../../store/appStore';
import { createGroup, createTransaction, getLayout, listTransactions, saveSettings } from '../../data/repo';

const U = 'u1';
const today = new Date();
const d = (off) => {
    const x = new Date(today);
    x.setDate(x.getDate() - off);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    queryClient.clear();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    useAppStore.setState({ currentUser: { userId: U }, isAuthenticated: true, languageCode: 'en', toast: null });
});
let current = null;
afterEach(async () => {
    if (current) await act(async () => current.unmount());
    current = null;
});
async function mount(path) {
    document.body.replaceChildren();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () =>
        root.render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[path]}>
                    <Routes>
                        <Route path="/activity" element={<ActivityPage />} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        )
    );
    current = root;
    return root;
}
const until = async (fn) => {
    for (let i = 0; i < 50 && !fn(); i++) await act(async () => new Promise((r) => setTimeout(r, 40)));
    return fn();
};
const all = (sel) => [...document.querySelectorAll(sel)];

async function seed() {
    await saveSettings(U, { defaultCurrency: 'EUR', languageCode: 'en' });
    const g = {};
    for (const [name, color] of [['Debts', '#ef4444'], ['Subscriptions', '#8b5cf6'], ['Income', '#10b981'], ['Birthday gifts', '#f59e0b'], ['Lends', '#3b82f6']]) g[name] = await createGroup(U, { name, color });
    await createTransaction({ userId: U, merchant: 'Klarna', total: 49.9, date: d(0), category: 'Debt', groupId: g.Debts.id, groupName: 'Debts' });
    await createTransaction({ userId: U, merchant: 'Marco', total: 20, date: d(1), category: 'Debt', groupId: g.Debts.id, groupName: 'Debts' });
    await createTransaction({ userId: U, merchant: 'Netflix', total: 12.99, date: d(0), category: 'Subscriptions', groupId: g.Subscriptions.id, groupName: 'Subscriptions' });
    await createTransaction({ userId: U, merchant: 'Salary', total: 2350, date: d(0), category: 'Income', transactionType: 'income', groupId: g.Income.id, groupName: 'Income' });
    await createTransaction({ userId: U, merchant: 'Gift shop', total: 35, date: d(0), category: 'Gift', groupId: g['Birthday gifts'].id, groupName: 'Birthday gifts' });
    await createTransaction({ userId: U, merchant: 'Lidl', total: 23.47, date: d(0), category: 'Groceries' });
    return g;
}


const rowsText = () => all('[data-testid="transaction-row"]').map((r) => r.textContent);
const click = async (el) => act(async () => fireEvent.click(el));
const byText = (sel, text) => all(sel).find((b) => b.textContent.includes(text));

describe('Activity filters (pass 3)', () => {
    it('filter sheet: live count in the button, amount range and status, removable chips and clear all', async () => {
        await seed();
        await mount('/activity?m=all');
        await until(() => all('[data-testid="transaction-row"]').length === 6);
        await click(document.querySelector('[data-testid="chip-filters"]'));
        expect(document.querySelector('[data-testid="filter-apply"]').textContent).toMatch(/Show 6 transactions/);
        await act(async () => fireEvent.change(document.querySelector('[data-testid="amount-min"]'), { target: { value: '20' } }));
        await act(async () => fireEvent.change(document.querySelector('[data-testid="amount-max"]'), { target: { value: '60' } }));
        expect(document.querySelector('[data-testid="filter-apply"]').textContent).toMatch(/Show 4 transactions · .*128[,.]37/);
        await click(byText('[data-testid="filter-sheet"] button', 'Debts'));
        expect(document.querySelector('[data-testid="filter-apply"]').textContent).toMatch(/Show 2 transactions/);
        await click(document.querySelector('[data-testid="filter-apply"]'));
        await until(() => all('[data-testid="transaction-row"]').length === 2);
        const chips = all('[data-testid="active-filter"]').map((c) => c.textContent);
        expect(chips).toEqual(['Debts', '20 € – 60 €']);
        expect(document.querySelector('[data-testid="chip-filters"]').textContent).toBe('Filters · 2');
        await click(all('[data-testid="active-filter"]')[0]);
        await until(() => all('[data-testid="transaction-row"]').length === 4);
        await click(document.querySelector('[data-testid="clear-all"]'));
        await until(() => all('[data-testid="transaction-row"]').length === 6);
        expect(document.querySelector('[data-testid="active-filters"]')).toBeNull();
    });

    it('search syntax from the search field and recent searches', async () => {
        await seed();
        await mount('/activity?m=all');
        await until(() => all('[data-testid="transaction-row"]').length === 6);
        await click(document.querySelector('button[aria-label="Search"]'));
        const input = document.querySelector('[data-testid="activity-search"]');
        await act(async () => fireEvent.change(input, { target: { value: '>40' } }));
        await until(() => all('[data-testid="transaction-row"]').length === 2);
        expect(rowsText().join()).toMatch(/Klarna.*Salary|Salary.*Klarna/);
        await act(async () => fireEvent.change(input, { target: { value: 'debts' } }));
        await until(() => all('[data-testid="transaction-row"]').length === 2);
        await act(async () => fireEvent.focusOut(input));
        await act(async () => fireEvent.change(input, { target: { value: '' } }));
        await until(() => all('[data-testid="recent-search"]').length > 0);
        expect(all('[data-testid="recent-search"]').map((c) => c.textContent)).toEqual(['debts']);
    });

    it('saved views are stored in the synced prefs and applied from a chip', async () => {
        await seed();
        await mount('/activity?m=all');
        await until(() => all('[data-testid="transaction-row"]').length === 6);
        await click(document.querySelector('[data-testid="chip-filters"]'));
        await click(byText('[data-testid="filter-sheet"] button', 'Debts'));
        await act(async () => fireEvent.change(document.querySelector('[data-testid="view-name"]'), { target: { value: 'Debts this year' } }));
        await click(document.querySelector('[data-testid="save-view"]'));
        await until(() => false || all('[data-testid="saved-view"]').length === 1);
        const layout = await getLayout(U);
        expect(layout.layout.prefs.savedViews).toMatchObject([{ name: 'Debts this year', query: expect.stringContaining('group=') }]);
        // close without applying, then use the chip
        await act(async () => fireEvent.keyDown(document.activeElement, { key: 'Escape' }));
        await until(() => !document.querySelector('[data-testid="filter-sheet"]'));
        expect(all('[data-testid="transaction-row"]').length).toBe(6);
        await click(document.querySelector('[data-testid="saved-view"]'));
        await until(() => all('[data-testid="transaction-row"]').length === 2);
        expect(document.querySelector('[data-testid="saved-view"]').getAttribute('aria-pressed')).toBe('true');
    });

    it('an empty result names the filter that removes everything and offers to remove it', async () => {
        await seed();
        await mount('/activity?m=all&group=__missing__&cat=Groceries');
        await until(() => document.querySelector('[data-testid="empty-reason"]'));
        expect(document.body.textContent).toContain('Nothing matches together with');
        await click(document.querySelector('[data-testid="empty-reason"] button'));
        await until(() => all('[data-testid="transaction-row"]').length === 1);
        expect(rowsText()[0]).toContain('Lidl');
    });

    it('sort by merchant is remembered in prefs and used when the URL names no sort', async () => {
        await seed();
        await mount('/activity?m=all');
        await until(() => all('[data-testid="transaction-row"]').length === 6);
        await click(document.querySelector('[data-testid="view-button"]'));
        await click(byText('[aria-label="Sort by"] [role="radio"]', 'Merchant'));
        await until(() => rowsText()[0]?.startsWith('Gift shop'));
        expect((await getLayout(U)).layout.prefs.activitySort).toEqual({ sort: 'merchant', dir: 'asc' });
        await click(document.querySelector('[data-testid="sort-direction"]'));
        await until(() => rowsText()[0]?.startsWith('Salary'));
    });

    it('legacy dashboard links still filter', async () => {
        await seed();
        await mount('/activity?filter=merchant&merchant=Klarna');
        await until(() => all('[data-testid="transaction-row"]').length === 1);
        expect(all('[data-testid="active-filter"]').map((c) => c.textContent)).toEqual(['Klarna']);
    });
});
