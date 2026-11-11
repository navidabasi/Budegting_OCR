import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent } from '@testing-library/react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));

import BreakdownPage from '../BreakdownPage';
import { db, openDb } from '../../data/db';
import { queryClient } from '../../data/queryClient';
import { useAppStore } from '../../store/appStore';
import { createTransaction, saveSettings } from '../../data/repo';
import { serializeItems } from '../../utils/receiptItems';

const U = 'u1';
const line = (id, name, amount, subcategory, category = 'Groceries') => ({ v: 2, id, name, amount, category, subcategory, reviewStatus: 'confirmed', userEdited: [] });

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    queryClient.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    useAppStore.setState({ currentUser: { userId: U }, isAuthenticated: true, languageCode: 'en' });
});

async function mount() {
    document.body.replaceChildren();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () =>
        root.render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={['/breakdown?m=2026-11']}>
                    <Routes>
                        <Route path="/breakdown" element={<BreakdownPage />} />
                        <Route path="/receipts/:id" element={<div data-testid="detail">DETAIL</div>} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        )
    );
    return root;
}
const waitFor = async (fn, tries = 40) => {
    for (let i = 0; i < tries; i++) {
        if (fn()) return true;
        await act(async () => new Promise((r) => setTimeout(r, 40)));
    }
    return false;
};

describe('BreakdownPage (case 10 shape: grocery drilldown with honest coverage)', () => {
    it('shows merchant ranking, grocery subcategories, a coverage banner, and every number opens its receipts and lines', async () => {
        await saveSettings(U, { defaultCurrency: 'EUR', languageCode: 'en' });
        await createTransaction({ userId: U, merchant: 'Lidl', total: 40, date: '2026-11-03', category: 'Groceries', lineItems: serializeItems([line('1', 'Latte', 10, 'dairy'), line('2', 'Mele', 10, 'produce')]) });
        await createTransaction({ userId: U, merchant: 'Conad', total: 60, date: '2026-11-05', category: 'Groceries' });
        const id = await createTransaction({ userId: U, merchant: 'Lidl', total: 20, date: '2026-11-07', category: 'Groceries', lineItems: serializeItems([line('3', 'Yogurt', 20, 'dairy')]) });
        const root = await mount();
        expect(await waitFor(() => document.querySelector('[data-testid="coverage-banner"]')?.textContent.includes('33%'))).toBe(true);
        const banner = document.querySelector('[data-testid="coverage-banner"]').textContent;
        expect(banner).toContain('Item detail covers 33% of groceries spend');
        expect(banner).toMatch(/80[,.]00/); // the amount without item detail is stated, not hidden

        const merchants = [...document.querySelectorAll('[data-testid="merchant-row"]')].map((r) => r.textContent);
        expect(merchants).toHaveLength(2);
        expect(merchants.join('|')).toMatch(/Conad.*60/);
        expect(merchants.join('|')).toMatch(/Lidl.*60/);

        const groups = [...document.querySelectorAll('[data-testid="group-row"]')];
        const label = (r) => r.querySelector('span > span').textContent;
        expect(groups.map(label)).toEqual(['No subcategory', 'Dairy & eggs', 'Produce']);
        expect(groups[0].textContent).toContain('without item detail');

        // every number leads to the lines behind it
        await act(async () => fireEvent.click(groups[1]));
        const sheet = document.querySelector('[data-testid="drill-sheet"]');
        const rows = [...sheet.querySelectorAll('[data-testid="drill-row"]')];
        expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Yogurt'), expect.stringContaining('Latte')]);
        await act(async () => fireEvent.click(rows[0]));
        expect(document.querySelector('[data-testid="detail"]')).toBeTruthy(); // opens the receipt
        void id;
        await act(async () => root.unmount());
    });
});
