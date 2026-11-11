import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent } from '@testing-library/react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));

import ItemReviewList from '../ItemReviewList';
import { queryClient } from '../../../data/queryClient';
import { useAppStore } from '../../../store/appStore';

beforeEach(() => {
    queryClient.clear();
    useAppStore.setState({ currentUser: { userId: 'u1' }, languageCode: 'en' });
});

async function mount(ui) {
    document.body.replaceChildren();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
    return root;
}
const click = (el) => act(async () => fireEvent.click(el));
const byText = (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === text);

const receipt = { total: 20, currency: 'EUR', category: 'Groceries' };
const items = [
    { v: 2, id: 'a', name: 'Latte intero 1L', amount: 1.2, category: 'Groceries', subcategory: null, reviewStatus: 'auto', userEdited: [] },
    { v: 2, id: 'b', name: 'Pile AA', amount: 8, category: 'Groceries', subcategory: null, reviewStatus: 'needs_review', userEdited: [] },
];
const NAMES = ['Groceries', 'Shopping', 'Personal care', 'Other'];

describe('ItemReviewList', () => {
    it('shows each line with an uncertain-field flag, and the reconciliation with the unallocated amount', async () => {
        const root = await mount(<ItemReviewList items={items} receipt={receipt} categoryNames={NAMES} onChange={() => {}} />);
        const rows = document.querySelectorAll('[data-testid="item-row"]');
        expect(rows).toHaveLength(2);
        expect(rows[1].textContent).toContain('Check');
        expect(rows[0].textContent).not.toContain('Check');
        const rec = document.querySelector('[data-testid="reconcile"]');
        expect(rec.dataset.status).toBe('shortfall');
        expect(rec.textContent).toMatch(/10[,.]80/); // 20 - 9.20 is not itemised
        await act(async () => root.unmount());
    });

    it('a category change applies to that line only by default; the future rule is explicit', async () => {
        const onChange = vi.fn();
        const onFutureRule = vi.fn();
        const root = await mount(<ItemReviewList items={items} receipt={receipt} categoryNames={NAMES} onChange={onChange} onFutureRule={onFutureRule} />);
        await click(document.querySelectorAll('[data-testid="item-row"]')[1]);
        await click(byText('[data-testid="item-sheet"] button', 'Shopping'));
        const scope = document.querySelector('[data-testid="scope"]');
        expect(scope).toBeTruthy();
        expect(scope.querySelector('input[value="item"]').checked).toBe(true); // default scope: only this line
        await click(document.querySelector('[data-testid="item-save"]'));
        expect(onFutureRule).not.toHaveBeenCalled();
        const saved = onChange.mock.calls[0][0];
        expect(saved).toHaveLength(2);
        expect(saved[0]).toMatchObject({ id: 'a', category: 'Groceries' }); // the other line is untouched
        expect(saved[1]).toMatchObject({ id: 'b', category: 'Shopping', reviewStatus: 'confirmed', userEdited: ['category'] });

        // explicit: also for future purchases
        await click(document.querySelectorAll('[data-testid="item-row"]')[1]);
        await click(byText('[data-testid="item-sheet"] button', 'Personal care'));
        await click(document.querySelector('[data-testid="scope"] input[value="future"]'));
        await click(document.querySelector('[data-testid="item-save"]'));
        expect(onFutureRule).toHaveBeenCalledTimes(1);
        expect(onFutureRule.mock.calls[0][0]).toMatchObject({ id: 'b', category: 'Personal care' });
        await act(async () => root.unmount());
    });

    it('"Assign the difference" adds one explicit line so the items add up', async () => {
        const onChange = vi.fn();
        const root = await mount(<ItemReviewList items={items} receipt={receipt} categoryNames={NAMES} onChange={onChange} />);
        await click(byText('button', 'Assign the difference'));
        await click(byText('button', 'Add this line'));
        const next = onChange.mock.calls[0][0];
        expect(next).toHaveLength(3);
        expect(next[2]).toMatchObject({ amount: 10.8, category: 'Groceries', reviewStatus: 'confirmed' });
        await act(async () => root.unmount());
    });
});
