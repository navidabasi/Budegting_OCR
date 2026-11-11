import { describe, expect, it } from 'vitest';
import { amountMatches, amountQuery, applyFilters, groupByDay, monthKey, parseFilters, serializeFilters, summarize } from '../activityFilters';

const NOW = new Date(2026, 10, 10);
const P = (s) => new URLSearchParams(s);
const tx = (o) => ({ id: Math.random().toString(), merchant: 'X', total: 10, date: '2026-11-05', category: 'Groceries', transactionType: 'expense', ...o });

describe('filter URL round trip', () => {
    it('defaults to the current month and serialises to an empty query', () => {
        const f = parseFilters(P(''), NOW);
        expect(f.month).toBe('2026-11');
        expect(serializeFilters(f, NOW).toString()).toBe('');
    });
    it('round-trips every filter', () => {
        const q = 'm=2026-09&type=income&cat=Groceries%2CDining&acct=a1&tracking=open&uncat=1&merchant=Lidl&q=12%2C40&sort=amount&dir=asc';
        const f = parseFilters(P(q), NOW);
        expect(f).toMatchObject({ month: '2026-09', type: 'income', categories: ['Groceries', 'Dining'], accountId: 'a1', tracking: 'open', uncategorised: true, merchant: 'Lidl', q: '12,40', sort: 'amount', dir: 'asc' });
        const again = parseFilters(serializeFilters(f, NOW), NOW);
        expect(again).toEqual(f);
    });
    it('keeps existing dashboard links working', () => {
        expect(parseFilters(P('type=income'), NOW)).toMatchObject({ type: 'income', month: 'all' });
        expect(parseFilters(P('type=expense&month=11&year=2026'), NOW)).toMatchObject({ type: 'expense', month: '2026-11' });
        expect(parseFilters(P('filter=category&category=Groceries'), NOW)).toMatchObject({ categories: ['Groceries'], month: 'all' });
        expect(parseFilters(P('filter=month&month=3&year=2026'), NOW)).toMatchObject({ month: '2026-03', categories: [] });
        expect(parseFilters(P('filter=merchant&merchant=Lidl%20Italia'), NOW)).toMatchObject({ merchant: 'Lidl Italia', month: 'all' });
        expect(parseFilters(P('tracking=open'), NOW)).toMatchObject({ tracking: 'open', month: 'all' });
    });
    it('ignores garbage', () => {
        expect(parseFilters(P('m=bogus&type=zzz&sort=nope'), NOW)).toMatchObject({ month: monthKey(NOW), type: '', sort: 'date' });
    });
});

describe('amount search', () => {
    it('12.4 and 12,40 both match 12.40', () => {
        expect(amountMatches(12.4, '12.4')).toBe(true);
        expect(amountMatches(12.4, '12,40')).toBe(true);
        expect(amountMatches(12.4, '12')).toBe(true);
        expect(amountMatches(12.4, '12,5')).toBe(false);
        expect(amountMatches(1240.3, '1.240,30')).toBe(true);
        expect(amountMatches(-12.4, '12.4')).toBe(true);
    });
    it('is null for text', () => {
        expect(amountQuery('lidl')).toBeNull();
        expect(amountQuery('€ 5,50')).toBe('5.50');
    });
    it('search matches merchant, notes and amount', () => {
        const list = [tx({ merchant: 'Lidl', total: 12.4 }), tx({ merchant: 'Bar', notes: 'lidl coupon', total: 3 }), tx({ merchant: 'Conad', total: 99 })];
        const f = { ...parseFilters(P('m=all'), NOW) };
        expect(applyFilters(list, { ...f, q: 'lidl' })).toHaveLength(2);
        expect(applyFilters(list, { ...f, q: '12,40' }).map((t) => t.merchant)).toEqual(['Lidl']);
        expect(applyFilters(list, { ...f, q: '12.4' }).map((t) => t.merchant)).toEqual(['Lidl']);
    });
});

describe('applyFilters / summarize / groupByDay', () => {
    const list = [
        tx({ id: 'a', date: '2026-11-09', total: 400, transactionType: 'transfer', category: 'Transfer', accountId: 'a1', toAccountId: 'a4' }),
        tx({ id: 'b', date: '2026-11-09', total: 650, category: 'Utilities', trackingData: { isTracked: true, status: 'open' } }),
        tx({ id: 'c', date: '2026-11-09', total: 12.6, category: 'Other', accountId: 'a3' }),
        tx({ id: 'd', date: '2026-11-10', total: 23.47, accountId: 'a1' }),
        tx({ id: 'e', date: '2026-11-05', total: 2350, transactionType: 'income', category: 'Income' }),
        tx({ id: 'f', date: '2026-10-30', total: 5 }),
    ];
    const f = parseFilters(P(''), NOW);
    it('month, unpaid, uncategorised, account and type filters', () => {
        expect(applyFilters(list, f).map((t) => t.id)).toEqual(['d', 'a', 'b', 'c', 'e']);
        expect(applyFilters(list, { ...f, tracking: 'open' }).map((t) => t.id)).toEqual(['b']);
        expect(applyFilters(list, { ...f, uncategorised: true }).map((t) => t.id)).toEqual(['c']);
        expect(applyFilters(list, { ...f, accountId: 'a4' }).map((t) => t.id)).toEqual(['a']);
        expect(applyFilters(list, { ...f, type: 'transfer' }).map((t) => t.id)).toEqual(['a']);
        expect(applyFilters(list, { ...f, month: 'all' })).toHaveLength(6);
        expect(applyFilters(list, { ...f, sort: 'amount' })[0].id).toBe('e');
    });
    it('summarises money moved only', () => {
        expect(summarize(applyFilters(list, f))).toEqual({ count: 5, income: 2350, expense: 36.07, expenseShare: 36.07 });
    });
    it('groups by day with spending totals', () => {
        const items = groupByDay(applyFilters(list, f));
        expect(items.filter((i) => i.kind === 'day').map((d) => [d.key, d.total, d.count])).toEqual([['2026-11-10', 23.47, 1], ['2026-11-09', 12.6, 3], ['2026-11-05', 0, 1]]);
        expect(items[0].kind).toBe('day');
    });
});

describe('period specs in the month filter (pay cycles)', () => {
    it('accepts cycle and range specs and omits the default period from the URL', async () => {
        const { parseFilters, serializeFilters, applyFilters } = await import('../activityFilters');
        const f = parseFilters(new URLSearchParams('m=c%3A2026-10'), new Date(2026, 10, 11), { defaultSpec: 'c:2026-10' });
        expect(f.month).toBe('c:2026-10');
        expect(serializeFilters(f, new Date(2026, 10, 11), { defaultSpec: 'c:2026-10' }).toString()).toBe('');
        expect(parseFilters(new URLSearchParams('m=r%3A2026-10-01..2026-10-20')).month).toBe('r:2026-10-01..2026-10-20');
        expect(parseFilters(new URLSearchParams('m=junk'), new Date(2026, 10, 11), { defaultSpec: 'c:2026-10' }).month).toBe('c:2026-10');
        const txs = [{ id: 'a', date: '2026-10-12' }, { id: 'b', date: '2026-11-12' }];
        expect(applyFilters(txs, f, { period: { start: '2026-10-12', end: '2026-11-11' } }).map((t) => t.id)).toEqual(['a']);
    });
});

describe('summarize: basis and conversion', () => {
    const split = { v: 2, payer: 'me', participants: [{ id: 'me', name: 'Me' }, { id: 'm', name: 'M' }], method: 'equal', shares: { me: 2000, m: 2000 } };
    it('reports the full amount paid and, separately, your share; foreign records without a rate count as zero', () => {
        const list = [
            { id: '1', transactionType: 'expense', total: 40, currency: 'EUR', amountBase: 40, splitData: split, date: '2026-11-03' },
            { id: '2', transactionType: 'expense', total: 10, currency: 'EUR', amountBase: 10, date: '2026-11-03' },
            { id: '3', transactionType: 'expense', total: 99, currency: 'USD', amountBase: null, date: '2026-11-03' },
        ];
        expect(summarize(list)).toMatchObject({ count: 3, expense: 50, expenseShare: 30 });
    });
});
