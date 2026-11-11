import { describe, expect, it } from 'vitest';
import { groupDetail, groupSummaries, splitGroups, suggestGroupFor, totalsOf } from '../groupStats';

// The owner's real group names
const groups = [
    { id: 'g-debts', name: 'Debts', color: '#ef4444' },
    { id: 'g-subs', name: 'Subscriptions', color: '#8b5cf6', isPinned: true },
    { id: 'g-income', name: 'Income', color: '#10b981' },
    { id: 'g-gifts', name: 'Birthday gifts', color: '#f59e0b' },
    { id: 'g-lends', name: 'Lends', color: '#3b82f6' },
    { id: 'trip-1', name: 'Lisbon', kind: 'trip', startsOn: '2026-10-01' },
];
const tx = (id, o) => ({ id, merchant: 'X', total: 10, date: '2026-11-05', category: 'Other', transactionType: 'expense', ...o });
const rows = [
    tx('1', { merchant: 'Klarna', total: 49.9, groupId: 'g-debts', category: 'Debt', date: '2026-11-02' }),
    tx('2', { merchant: 'Klarna', total: 49.9, groupId: 'g-debts', category: 'Debt', date: '2026-10-02' }),
    tx('3', { merchant: 'Netflix', total: 12.99, groupId: 'g-subs', category: 'Subscriptions', date: '2026-11-03' }),
    tx('4', { merchant: 'Salary', total: 2350, groupId: 'g-income', transactionType: 'income', category: 'Income', date: '2026-11-01' }),
    tx('5', { merchant: 'Gift shop', total: 35, groupId: 'g-gifts', category: 'Gift', date: '2026-11-04' }),
    tx('6', { merchant: 'Marco', total: 50, groupId: 'g-lends', transactionType: 'transfer', category: 'Transfer', date: '2026-11-06' }),
    tx('7', { merchant: 'Klarna', total: 49.9, groupId: 'g-debts', category: 'Debt', date: '2026-12-02', trackingData: { isTracked: true, status: 'open' } }),
    tx('8', { merchant: 'Lidl', total: 20, groupId: null, date: '2026-11-05' }),
    tx('9', { merchant: 'Metro', total: 6.8, groupId: 'trip-1', category: 'Transport', date: '2026-10-03' }),
];
const NOV = { start: '2026-11-01', end: '2026-11-30' };

describe('groupStats', () => {
    it('splits plain groups (pinned first, by name) from trips', () => {
        const { groups: g, trips } = splitGroups(groups);
        expect(g.map((x) => x.name)).toEqual(['Subscriptions', 'Birthday gifts', 'Debts', 'Income', 'Lends']);
        expect(trips.map((x) => x.name)).toEqual(['Lisbon']);
    });
    it('totals per group for the period and all time; planned records count but do not add', () => {
        const s = Object.fromEntries(groupSummaries(splitGroups(groups).groups, rows, NOV).map((x) => [x.group.name, x]));
        expect(s.Debts.period).toEqual({ count: 1, out: 49.9, in: 0, net: -49.9 });
        expect(s.Debts.all).toEqual({ count: 3, out: 99.8, in: 0, net: -99.8 });
        expect(s.Debts.lastDate).toBe('2026-12-02');
        expect(s.Income.period).toMatchObject({ in: 2350, out: 0 });
        expect(s.Lends.period).toMatchObject({ out: 50, count: 1 });
        expect(s['Birthday gifts'].period.out).toBe(35);
        expect(s.Subscriptions.all.count).toBe(1);
    });
    it('detail: rows newest first and the per-category split of money out', () => {
        const d = groupDetail(groups[0], rows, null);
        expect(d.rows.map((r) => r.id)).toEqual(['7', '1', '2']);
        expect(d.byCategory).toEqual([{ category: 'Debt', amount: 99.8, share: 1 }]);
        const nov = groupDetail(groups[0], rows, NOV);
        expect(nov.period.count).toBe(1);
        expect(nov.all.count).toBe(3);
    });
    it('suggests the group of the last transaction at the same merchant, never a trip', () => {
        expect(suggestGroupFor('KLARNA', rows, groups)?.name).toBe('Debts');
        expect(suggestGroupFor('Metro', rows, groups)).toBeNull();
        expect(suggestGroupFor('Lidl', rows, groups)).toBeNull();
        expect(suggestGroupFor('', rows, groups)).toBeNull();
    });
    it('totalsOf handles an empty list', () => {
        expect(totalsOf([])).toEqual({ count: 0, out: 0, in: 0, net: 0 });
    });
});
