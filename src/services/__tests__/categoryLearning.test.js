import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../data/api', () => ({
    isConfigured: vi.fn(() => false),
    isMissingTableError: vi.fn(() => false),
    isTransientError: vi.fn(() => true),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
    removeGroup: vi.fn(),
    fetchUpdatedAt: vi.fn(),
    fetchSince: vi.fn(async () => []),
    fetchIds: vi.fn(async () => []),
}));
vi.mock('../../data/queryClient', () => ({ notifyDataChanged: vi.fn(), queryClient: {} }));

import { db, openDb } from '../../data/db';
import * as repo from '../../data/repo';
import { applyCategoryToMatches, countSameMerchant, findMatches, onCategoryChanged } from '../categoryLearning';

const U = 'u1';
const mk = (id, merchant, category, extra = {}) => repo.createTransaction({ id, userId: U, merchant, total: 10, date: '2026-11-0' + id.slice(-1), category, ...extra });

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
});

describe('learning from category corrections', () => {
    it('upserts a user rule (hitCount + 1) and reports the other transactions of the merchant', async () => {
        await mk('t1', 'LIDL ITALIA S.R.L. 0231 TORINO', 'Other');
        await mk('t2', 'Lidl', 'Other');
        await mk('t3', 'Lidl Torino', 'Groceries'); // already right
        await mk('t4', 'Bar Roma', 'Other');
        const tx = await repo.getTransaction('t1');

        const res = await onCategoryChanged(tx, 'Groceries');
        expect(res.key).toBe('lidl');
        expect(res.matches.map((m) => m.id).sort()).toEqual(['t2']);
        expect((await repo.getTransaction('t1')).category).toBe('Groceries');
        let rules = await repo.listRows('rules', U);
        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({ merchantKey: 'lidl', category: 'Groceries', source: 'user', hitCount: 1 });

        await onCategoryChanged(await repo.getTransaction('t2'), 'Dining');
        rules = await repo.listRows('rules', U);
        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({ category: 'Dining', hitCount: 2 });
    });

    it('applies the category to all matches in one batch and undoes it', async () => {
        for (const [id, m] of [['t1', 'Lidl'], ['t2', 'Lidl'], ['t3', 'LIDL 0231'], ['t4', 'Conad']]) await mk(id, m, 'Other');
        const res = await onCategoryChanged(await repo.getTransaction('t1'), 'Groceries');
        expect(res.matches).toHaveLength(2);
        const outboxBefore = await db.outbox.count();

        const applied = await applyCategoryToMatches(res.matches, 'Groceries');
        expect(applied.count).toBe(2);
        expect((await repo.listTransactions(U)).filter((t) => t.category === 'Groceries').map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
        expect((await repo.getTransaction('t4')).category).toBe('Other');
        expect(await db.outbox.count()).toBeGreaterThanOrEqual(outboxBefore);

        await applied.undo();
        expect((await repo.getTransaction('t2')).category).toBe('Other');
        expect((await repo.getTransaction('t3')).category).toBe('Other');
        expect((await repo.getTransaction('t1')).category).toBe('Groceries');
    });

    it('does nothing for transfers, income and unchanged categories', async () => {
        await mk('t1', 'Salary', 'Income', { transactionType: 'income' });
        const same = await onCategoryChanged(await repo.getTransaction('t1'), 'Income');
        expect(same.matches).toEqual([]);
        await mk('t2', 'To Savings', 'Transfer', { transactionType: 'transfer' });
        const res = await onCategoryChanged(await repo.getTransaction('t2'), 'Other');
        expect(res.rule).toBeNull();
        expect(await repo.listRows('rules', U)).toHaveLength(0);
    });

    it('findMatches / countSameMerchant are pure helpers over merchantKey', () => {
        const list = [
            { id: 'a', merchant: 'Lidl', category: 'Other' },
            { id: 'b', merchant: 'LIDL ITALIA SRL', category: 'Groceries' },
            { id: 'c', merchant: 'Lidl', category: 'Other', transactionType: 'income' },
        ];
        expect(countSameMerchant(list, list[0])).toBe(2);
        expect(findMatches(list, list[0], 'Groceries')).toEqual([]);
        expect(findMatches(list, list[1], 'Dining').map((t) => t.id)).toEqual(['a']);
    });

    it('persists merchantKey lazily on the next write for rows saved without one', async () => {
        const now = new Date().toISOString();
        await db.transactions.put({ id: 'old', userId: U, merchant: 'Esselunga SPA', total: 5, currency: 'EUR', date: '2026-11-01', category: 'Other', createdAt: now, updatedAt: now });
        expect((await repo.getTransaction('old')).merchantKey).toBe('esselunga'); // computed on read
        expect((await db.transactions.get('old')).merchantKey).toBeUndefined(); // not written by a read
        await repo.updateTransaction('old', { notes: 'x' });
        expect((await db.transactions.get('old')).merchantKey).toBe('esselunga');
    });
});
