import { describe, expect, it } from 'vitest';
import { categoryForMerchant, rankCategories, recentMerchants } from '../quickAdd';

const NOW = new Date('2026-11-10T12:00:00Z').getTime();
const tx = (merchant, date, extra = {}) => ({ merchant, date, category: 'Groceries', transactionType: 'expense', ...extra });

describe('recentMerchants', () => {
    const list = [
        tx('Lidl', '2026-11-08'), tx('lidl ', '2026-11-01'), tx('Lidl', '2026-10-20'),
        tx('Conad', '2026-11-09'), tx('Conad', '2026-10-01'),
        tx('Bar Roma', '2026-11-10'),
        tx('Old Shop', '2026-05-01'), tx('Old Shop', '2026-05-02'), tx('Old Shop', '2026-05-03'),
        tx('Salary Co', '2026-11-05', { transactionType: 'income' }),
        tx('Demo', '2026-11-05', { isDemo: true }),
    ];
    it('is most frequent first within 90 days and merges case variants', () => {
        expect(recentMerchants(list, { now: NOW })).toEqual(['Lidl', 'Conad', 'Bar Roma']);
    });
    it('respects the limit and ignores income, demo and old rows', () => {
        expect(recentMerchants(list, { now: NOW, limit: 1 })).toEqual(['Lidl']);
        expect(recentMerchants(list, { now: NOW })).not.toContain('Old Shop');
    });
});

describe('categoryForMerchant / rankCategories', () => {
    it('uses the latest category at the merchant', () => {
        const list = [tx('Lidl', '2026-10-01', { category: 'Shopping' }), tx('lidl', '2026-11-01', { category: 'Groceries' })];
        expect(categoryForMerchant(list, 'LIDL')).toBe('Groceries');
        expect(categoryForMerchant(list, 'Nope')).toBeNull();
    });
    it('puts the suggestion first, then by usage', () => {
        const list = [tx('a', '2026-11-01', { category: 'Dining' }), tx('b', '2026-11-02', { category: 'Dining' }), tx('c', '2026-11-03', { category: 'Transport' })];
        const r = rankCategories({ suggested: 'Shopping', transactions: list, names: ['Groceries', 'Dining', 'Transport', 'Shopping', 'Other'], limit: 3 });
        expect(r.top).toEqual(['Shopping', 'Dining', 'Transport']);
        expect(r.all).toHaveLength(5);
    });
});
