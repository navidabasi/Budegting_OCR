import { describe, expect, it } from 'vitest';
import { applyFilters, clearedFilters, describeFilters, emptyReason, groupItems, matchesSearch, mergeFilters, NO_GROUP, optionStats, parseFilters, parseSearchToken, serializeFilters } from '../activityFilters';

const NOW = new Date(2026, 10, 10);
const P = (s) => new URLSearchParams(s);
const tx = (id, o) => ({ id, merchant: 'X', total: 10, date: '2026-11-05', category: 'Groceries', transactionType: 'expense', ...o });
const list = [
    tx('a', { merchant: 'Lidl', total: 23.47, groupId: 'g-debts', groupName: 'Debts', accountId: 'a1', imagePath: 'p.jpg', lineItems: [{ name: 'Latte intero' }] }),
    tx('b', { merchant: 'Klarna', total: 49.9, category: 'Debt', groupId: 'g-debts', groupName: 'Debts', accountId: 'a2', groupTags: ['bnpl'] }),
    tx('c', { merchant: 'Netflix', total: 12.99, category: 'Subscriptions', groupId: 'g-subs', groupName: 'Subscriptions', accountId: 'a1' }),
    tx('d', { merchant: 'Pizzeria', total: 60, category: 'Dining', splitData: { v: 2, payer: 'me', participants: [{ id: 'me' }, { id: 'm' }], method: 'equal', shares: { me: 3000, m: 3000 } } }),
    tx('e', { merchant: 'Receipt', total: 0, category: 'Other', extraction: { pending: true } }),
    tx('f', { merchant: 'Salary', total: 2350, transactionType: 'income', category: 'Income', groupId: 'g-income', groupName: 'Income' }),
    tx('g', { merchant: 'Lidl', total: 5.5, date: '2026-10-20' }),
];
const all = { ...parseFilters(P('m=all'), NOW) };

describe('filter model (pass 3)', () => {
    it('round-trips the new parameters', () => {
        const q = 'm=all&group=g1,g2&trip=t1&acct=a1,a2&merchant=Lidl&merchant=Conad&tag=x&min=10&max=50,5&photo=1&shared=1&review=1&sort=merchant&dir=asc';
        const f = parseFilters(P(q), NOW);
        expect(f).toMatchObject({ groupIds: ['g1', 'g2'], groupId: 'g1', tripId: 't1', accountIds: ['a1', 'a2'], merchants: ['Lidl', 'Conad'], tags: ['x'], amountMin: 10, amountMax: 50.5, hasPhoto: true, shared: true, needsReview: true, sort: 'merchant', dir: 'asc' });
        expect(parseFilters(serializeFilters(f, NOW), NOW)).toEqual(f);
    });
    it('legacy single group= and acct= still filter, and a new filter without m means all time', () => {
        expect(parseFilters(P('group=g-debts'), NOW)).toMatchObject({ month: 'all', groupIds: ['g-debts'], groupId: 'g-debts' });
        expect(parseFilters(P('photo=1'), NOW).month).toBe('all');
        expect(applyFilters(list, parseFilters(P('group=g-debts'), NOW)).map((t) => t.id)).toEqual(['a', 'b']);
    });
    it('mergeFilters keeps the legacy single fields in step with the arrays', () => {
        const f = mergeFilters(all, { accountId: 'a2' });
        expect(f.accountIds).toEqual(['a2']);
        expect(mergeFilters(f, { accountIds: [] }).accountId).toBe('');
        expect(mergeFilters(all, { groupIds: ['x', 'x', 'y'] })).toMatchObject({ groupIds: ['x', 'y'], groupId: 'x' });
    });
    it('a remembered sort is the default and is omitted from the URL', () => {
        const ds = { sort: 'amount', dir: 'asc' };
        const f = parseFilters(P(''), NOW, { defaultSort: ds });
        expect(f).toMatchObject({ sort: 'amount', dir: 'asc' });
        expect(serializeFilters(f, NOW, { defaultSort: ds }).toString()).toBe('');
        expect(serializeFilters({ ...f, sort: 'date', dir: 'desc' }, NOW, { defaultSort: ds }).toString()).toBe('sort=date&dir=desc');
    });
    it('multi group, account, merchant, tag, amount range and status filters', () => {
        const ids = (patch) => applyFilters(list, mergeFilters(all, patch)).map((t) => t.id).sort();
        expect(ids({ groupIds: ['g-debts', 'g-subs'] })).toEqual(['a', 'b', 'c']);
        expect(ids({ accountIds: ['a2'] })).toEqual(['b']);
        expect(ids({ merchants: ['Lidl'] })).toEqual(['a', 'g']);
        expect(ids({ tags: ['bnpl'] })).toEqual(['b']);
        expect(ids({ amountMin: 20, amountMax: 60 })).toEqual(['a', 'b', 'd']);
        expect(ids({ hasPhoto: true })).toEqual(['a']);
        expect(ids({ shared: true })).toEqual(['d']);
        expect(ids({ needsReview: true })).toEqual(['e']);
    });
    it('sorts by merchant and category', () => {
        expect(applyFilters(list, { ...all, sort: 'merchant', dir: 'asc' }).map((t) => t.merchant)[0]).toBe('Klarna');
        expect(applyFilters(list, { ...all, sort: 'category', dir: 'asc' }).map((t) => t.category)[0]).toBe('Debt');
    });
});

describe('search syntax', () => {
    it('reads comparison and range tokens', () => {
        expect(parseSearchToken('>50').test(51)).toBe(true);
        expect(parseSearchToken('<=20').test(20)).toBe(true);
        expect(parseSearchToken('10-20').test(15)).toBe(true);
        expect(parseSearchToken('10-20').test(25)).toBe(false);
        expect(parseSearchToken('12,40').kind).toBe('num');
        expect(parseSearchToken('lidl').kind).toBe('text');
    });
    it('matches merchant, item names, category, group, tags and amounts; every token must match', () => {
        const q = (s) => applyFilters(list, { ...all, q: s }, { localizeCategory: (c) => (c === 'Groceries' ? 'Spesa' : c) }).map((t) => t.id).sort();
        expect(q('latte')).toEqual(['a']);
        expect(q('debts')).toEqual(['a', 'b']);
        expect(q('bnpl')).toEqual(['b']);
        expect(q('spesa')).toEqual(['a', 'g']);
        expect(q('>50')).toEqual(['d', 'f']);
        expect(q('10-25')).toEqual(['a', 'c']);
        expect(q('lidl >20')).toEqual(['a']);
        expect(q('23,47')).toEqual(['a']);
        expect(q('23.4')).toEqual(['a']);
    });
    it('ignores accents', () => {
        expect(matchesSearch({ merchant: 'Pastéis de Belém', total: 1 }, 'pasteis')).toBe(true);
    });
});

describe('describeFilters / emptyReason / optionStats / clearedFilters', () => {
    it('describes every active filter with the patch that removes it', () => {
        const f = mergeFilters(all, { categories: ['Dining', 'Debt'], groupIds: ['g-debts'], amountMin: 10, hasPhoto: true, q: 'lidl' });
        const d = describeFilters(f);
        expect(d.map((x) => x.id)).toEqual(['cat:Dining', 'cat:Debt', 'group:g-debts', 'amount', 'photo', 'q']);
        expect(d[0].patch).toEqual({ categories: ['Debt'] });
        expect(d.find((x) => x.id === 'amount').value).toEqual({ min: 10, max: null });
        expect(describeFilters(mergeFilters(f, d[2].patch)).some((x) => x.kind === 'group')).toBe(false);
    });
    it('names the filter that empties the list', () => {
        const f = mergeFilters(all, { groupIds: ['g-subs'], merchants: ['Lidl'] });
        expect(applyFilters(list, f)).toHaveLength(0);
        const r = emptyReason(list, f);
        expect(r.descriptor.kind).toBe('group'); // removing the group brings back both Lidl rows, removing Lidl only Netflix
        expect(r.count).toBe(2);
        const p = mergeFilters(parseFilters(P('m=2026-09'), NOW));
        expect(emptyReason(list, p).descriptor.kind).toBe('period');
    });
    it('counts and totals per option', () => {
        const s = optionStats(list, (t) => t.groupId);
        expect(s.get('g-debts')).toEqual({ count: 2, total: 73.37 });
        expect(s.get('g-income')).toEqual({ count: 1, total: 2350 });
    });
    it('clear all keeps the period and sort', () => {
        const f = mergeFilters(all, { categories: ['Dining'], sort: 'amount' });
        expect(describeFilters(clearedFilters(f))).toEqual([]);
        expect(clearedFilters(f)).toMatchObject({ month: 'all', sort: 'amount' });
    });
});

describe('groupItems', () => {
    it('groups by group with totals, the no-group section last and collapsed sections without rows', () => {
        const rows = applyFilters(list, all);
        const items = groupItems(rows, 'group', { collapsed: new Set(['g-subs']) });
        const heads = items.filter((i) => i.kind === 'section');
        expect(heads.map((h) => h.key)).toEqual(['g-debts', 'g-subs', 'g-income', NO_GROUP]);
        expect(heads[0]).toMatchObject({ expense: 73.37, count: 2, collapsed: false });
        expect(heads[2]).toMatchObject({ income: 2350 });
        const subsIndex = items.findIndex((i) => i.key === 'g-subs');
        expect(items[subsIndex + 1].kind).toBe('section');
    });
    it('groups by category and merchant; day is the default', () => {
        const rows = applyFilters(list, all);
        expect(groupItems(rows, 'category').filter((i) => i.kind === 'section')[0].key).toBe('Dining');
        const m = groupItems(rows, 'merchant', { labelOf: (k, t) => t.merchant }).filter((i) => i.kind === 'section');
        expect(m.find((s) => s.key === 'lidl')).toMatchObject({ count: 2, expense: 28.97, label: 'Lidl' });
        expect(groupItems(rows, 'day')[0].kind).toBe('day');
    });
});
