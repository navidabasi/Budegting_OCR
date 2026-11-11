import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ActivityTable from '../ActivityTable';

const rows = [
    { id: 'a', date: '2026-11-10', merchant: 'Lidl', category: 'Groceries', total: 23.47, currency: 'EUR', accountId: 'a1', transactionType: 'expense' },
    { id: 'b', date: '2026-11-09', merchant: 'Salary', category: 'Income', total: 2350, currency: 'EUR', accountId: 'a1', transactionType: 'income' },
    { id: 'c', date: '2026-11-08', merchant: 'Rent', category: 'Housing', total: 650, currency: 'EUR', accountId: 'a2', transactionType: 'expense' },
];
const base = () => ({ rows, selectedId: '', onSelect: vi.fn(), onActivate: vi.fn(), onClear: vi.fn(), sort: { sort: 'date', dir: 'desc' }, onSort: vi.fn(), accountById: new Map([['a1', 'Revolut'], ['a2', 'Cash']]), syncStates: new Map(), currency: 'EUR' });
// jsdom has no layout: give the scroller a size so the virtualiser renders rows
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
    Element.prototype.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
});
afterEach(cleanup);

describe('ActivityTable', () => {
    it('is a table with sortable Date, Merchant, Category and Amount headers', () => {
        const p = base();
        render(<ActivityTable {...p} />);
        expect(screen.getByRole('table')).toBeTruthy();
        expect(screen.getAllByRole('columnheader').length).toBe(6);
        expect(screen.getAllByRole('columnheader').find((h) => h.getAttribute('aria-sort') === 'descending')).toBeTruthy();
        fireEvent.click(screen.getByTestId('sort-amount'));
        expect(p.onSort).toHaveBeenCalledWith({ sort: 'amount', dir: 'desc' });
        fireEvent.click(screen.getByTestId('sort-date'));
        expect(p.onSort).toHaveBeenLastCalledWith({ sort: 'date', dir: 'asc' });
    });

    it('selects a row on click and marks it', async () => {
        const p = { ...base(), selectedId: 'b' };
        render(<ActivityTable {...p} />);
        const all = await screen.findAllByTestId('activity-row');
        const selected = all.filter((r) => r.getAttribute('aria-selected') === 'true');
        expect(selected).toHaveLength(1);
        expect(within(selected[0]).getByText('Salary')).toBeTruthy();
        fireEvent.click(all[2]);
        expect(p.onSelect).toHaveBeenCalledWith('c');
    });

    it('j/k/arrows move, Enter activates, Esc clears (from anywhere on the page)', () => {
        const p = { ...base(), selectedId: 'b' };
        render(<ActivityTable {...p} />);
        fireEvent.keyDown(window, { key: 'j' });
        expect(p.onSelect).toHaveBeenLastCalledWith('c');
        fireEvent.keyDown(window, { key: 'ArrowUp' });
        expect(p.onSelect).toHaveBeenLastCalledWith('a');
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(p.onActivate).toHaveBeenCalledWith('b');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(p.onClear).toHaveBeenCalled();
    });

    it('ignores the keys while typing in a field', () => {
        const p = base();
        render(
            <>
                <input aria-label="search" />
                <ActivityTable {...p} />
            </>
        );
        fireEvent.keyDown(screen.getByLabelText('search'), { key: 'j' });
        expect(p.onSelect).not.toHaveBeenCalled();
    });

    it('shows the group badge and opens a column filter from the header', async () => {
        const onHeaderFilter = vi.fn();
        const p = { ...base(), rows: [{ ...rows[0], groupId: 'g1' }], groupById: new Map([['g1', { id: 'g1', name: 'Debts', color: '#ef4444' }]]), onHeaderFilter, activeColumns: new Set(['group']) };
        render(<ActivityTable {...p} />);
        expect((await screen.findAllByTestId('group-badge'))[0].textContent).toBe('Debts');
        expect(screen.getByTestId('filter-group').getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByTestId('filter-category'));
        expect(onHeaderFilter).toHaveBeenCalledWith('category');
    });

    it('renders grouped sections as header rows and keeps keyboard moves on transactions', async () => {
        const onToggleSection = vi.fn();
        const items = [
            { kind: 'section', by: 'group', key: 'g1', label: 'Debts', count: 1, expense: 23.47, income: 0, collapsed: false },
            { kind: 'tx', tx: rows[0] },
            { kind: 'section', by: 'group', key: '__none__', label: 'No group', count: 2, expense: 650, income: 2350, collapsed: false },
            { kind: 'tx', tx: rows[1] },
            { kind: 'tx', tx: rows[2] },
        ];
        const p = { ...base(), items, selectedId: 'a', onToggleSection };
        render(<ActivityTable {...p} />);
        expect(screen.getAllByTestId('table-section')).toHaveLength(2);
        fireEvent.keyDown(window, { key: 'j' });
        expect(p.onSelect).toHaveBeenLastCalledWith('b');
        fireEvent.click(within(screen.getAllByTestId('table-section')[0]).getByRole('button'));
        expect(onToggleSection).toHaveBeenCalledWith('g1');
    });

    it('shows expenses negative and income positive in the amount column', async () => {
        render(<ActivityTable {...base()} />);
        const cells = (await screen.findAllByTestId('activity-row')).map((r) => within(r).getAllByRole('cell').pop().textContent);
        expect(cells[0]).toMatch(/^−/);
        expect(cells[1]).toMatch(/^\+/);
    });
});
