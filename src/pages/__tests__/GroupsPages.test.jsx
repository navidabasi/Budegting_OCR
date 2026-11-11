import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent } from '@testing-library/react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));

import GroupsPage from '../GroupsPage';
import GroupDetailPage from '../GroupDetailPage';
import ActivityPage from '../ActivityPage';
import { db, openDb } from '../../data/db';
import { queryClient } from '../../data/queryClient';
import { useAppStore } from '../../store/appStore';
import { createGroup, createTransaction, listTransactions, saveSettings } from '../../data/repo';

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
                        <Route path="/groups" element={<GroupsPage />} />
                        <Route path="/groups/:id" element={<GroupDetailPage />} />
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

describe('Groups pages (pass 3)', () => {
    it('lists the owner groups with period totals; income groups show money in', async () => {
        await seed();
        await mount('/groups');
        await until(() => all('[data-testid="group-row"]').length === 5);
        expect(all('[data-testid="group-row-name"]').map((r) => r.textContent)).toEqual(['Birthday gifts', 'Debts', 'Income', 'Lends', 'Subscriptions']);
        const row = (name) => all('[data-testid="group-row"]').find((r) => r.querySelector('[data-testid="group-row-name"]').textContent === name).textContent;
        expect(row('Debts')).toMatch(/69[,.]90/);
        expect(row('Income')).toMatch(/\+2[,.]?350[,.]00/);
        expect(row('Lends')).toContain('no transactions yet');
    });

    it('group detail: totals, category split, add transactions and rename', async () => {
        const g = await seed();
        await mount(`/groups/${g.Debts.id}`);
        await until(() => all('[data-testid="group-tx"]').length === 2);
        expect(document.querySelector('h1').textContent).toBe('Debts');
        expect(all('[data-testid="group-cat"]')[0].textContent).toMatch(/Debt.*69[,.]90.*100%/);
        expect(all('[data-testid="group-tx"]').length).toBe(2);
        expect(document.querySelector('[data-testid="group-in-activity"]').getAttribute('href')).toContain(`group=${g.Debts.id}`);

        await act(async () => fireEvent.click(document.querySelector('[data-testid="group-add"]')));
        await until(() => all('[data-testid="add-candidate"]').length > 0);
        const lidl = all('[data-testid="add-candidate"]').find((b) => b.textContent.includes('Lidl'));
        await act(async () => fireEvent.click(lidl));
        await act(async () => fireEvent.click(document.querySelector('[data-testid="add-confirm"]')));
        await until(() => all('[data-testid="group-tx"]').length === 3);
        expect((await listTransactions(U)).find((t) => t.merchant === 'Lidl')).toMatchObject({ groupId: g.Debts.id, groupName: 'Debts' });

        await act(async () => fireEvent.click(document.querySelector('[data-testid="group-edit"]')));
        const input = document.querySelector('[data-testid="group-name"]');
        await act(async () => fireEvent.change(input, { target: { value: 'Debts 2026' } }));
        await act(async () => fireEvent.click(document.querySelector('[data-testid="group-save"]')));
        await until(() => document.querySelector('h1').textContent === 'Debts 2026');
        expect((await listTransactions(U)).filter((t) => t.groupName === 'Debts 2026')).toHaveLength(3);
    });

    it('deleting a group keeps its transactions without a group (inline confirmation, no confirm())', async () => {
        const g = await seed();
        const confirmSpy = vi.spyOn(window, 'confirm');
        await mount(`/groups/${g.Lends.id}`);
        await until(() => document.querySelector('h1')?.textContent === 'Lends');
        await act(async () => fireEvent.click(document.querySelector('[data-testid="group-edit"]')));
        const del = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete group…');
        await act(async () => fireEvent.click(del));
        await act(async () => fireEvent.click(document.querySelector('[data-testid="group-delete-confirm"]')));
        await until(() => all('[data-testid="group-row"]').length === 4);
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('Activity: labelled Groups button, group badge on rows, Group chip and Group by sections', async () => {
        await seed();
        await mount('/activity');
        await until(() => all('[data-testid="transaction-row"]').length > 0);
        expect(document.querySelector('[data-testid="groups-link"]').textContent).toBe('Groups');
        expect(all('[data-testid="group-badge"]').map((b) => b.textContent)).toEqual(expect.arrayContaining(['Debts', 'Subscriptions', 'Income', 'Birthday gifts']));
        // Group chip -> picker with counts
        await act(async () => fireEvent.click(document.querySelector('[data-testid="chip-group"]')));
        const debts = [...document.querySelectorAll('[role="checkbox"]')].find((b) => b.textContent.includes('Debts'));
        expect(debts.textContent).toMatch(/2/);
        await act(async () => fireEvent.click(debts));
        await until(() => all('[data-testid="transaction-row"]').length === 2);
        // Group by group
        await act(async () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' }));
        await act(async () => fireEvent.click(document.querySelector('[data-testid="view-button"]')));
        const byGroup = [...document.querySelectorAll('[data-testid="group-by"] [role="radio"]')].find((b) => b.textContent === 'Group');
        await act(async () => fireEvent.click(byGroup));
        await until(() => all('[data-testid="section-header"]').length > 0);
        expect(all('[data-testid="section-header"]')[0].textContent).toContain('Debts');
        // collapse hides the rows
        await act(async () => fireEvent.click(all('[data-testid="section-header"]')[0]));
        await until(() => all('[data-testid="transaction-row"]').length === 0);
        expect(all('[data-testid="section-header"]')[0].getAttribute('aria-expanded')).toBe('false');
    });
});
