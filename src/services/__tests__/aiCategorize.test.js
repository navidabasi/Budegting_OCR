import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../data/api', () => ({
    isConfigured: vi.fn(() => false), isMissingTableError: vi.fn(() => false), isTransientError: vi.fn(() => true),
    insert: vi.fn(), update: vi.fn(), upsert: vi.fn(), remove: vi.fn(), removeGroup: vi.fn(), fetchUpdatedAt: vi.fn(), fetchOne: vi.fn(async () => null), fetchSince: vi.fn(async () => []), fetchIds: vi.fn(async () => []),
}));
vi.mock('../../data/queryClient', () => ({ notifyDataChanged: vi.fn(), queryClient: {} }));

import { db, openDb } from '../../data/db';
import * as repo from '../../data/repo';
import { AiError, applySuggestions, categorizeMerchants, chunk, uncategorisedMerchants } from '../aiCategorize';

const U = 'u1';
const online = (v) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
const reply = (status, body) => async () => ({ status, ok: status < 400, json: async () => body });

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    online(true);
});

describe('uncategorisedMerchants', () => {
    it('groups uncategorised expenses by merchantKey and skips categorised, income, demo and transfers', () => {
        const tx = [
            { id: '1', merchant: 'LIDL 0231 TORINO', category: 'Other', lineItems: [{ name: 'Latte' }] },
            { id: '2', merchant: 'Lidl', category: '' },
            { id: '3', merchant: 'Bar Roma', category: 'Dining' },
            { id: '4', merchant: 'Salary', category: 'Other', transactionType: 'income' },
            { id: '5', merchant: 'Demo', category: 'Other', isDemo: true },
            { id: '6', merchant: 'To Savings', category: 'Transfer', transactionType: 'transfer' },
        ];
        const m = uncategorisedMerchants(tx);
        expect(m).toHaveLength(1);
        expect(m[0]).toMatchObject({ key: 'lidl', count: 2, transactionIds: ['1', '2'], sampleItems: ['Latte'] });
    });
    it('chunks into batches of at most 50', () => {
        expect(chunk(Array.from({ length: 120 }, (_, i) => i)).map((c) => c.length)).toEqual([50, 50, 20]);
    });
});

describe('categorizeMerchants', () => {
    const merchants = [
        { key: 'lidl', name: 'Lidl', description: null, sampleItems: [], count: 2, transactionIds: ['1', '2'] },
        { key: 'xyz', name: 'Xyz', description: null, sampleItems: [], count: 1, transactionIds: ['3'] },
    ];
    const categories = ['Groceries', 'Dining', 'Other'];

    it('sends a bearer token, preselects confidence >= 0.8 and never preselects Other', async () => {
        const fetchImpl = vi.fn(reply(200, { results: [{ key: 'lidl', category: 'Groceries', confidence: 0.95 }, { key: 'xyz', category: 'Other', confidence: 0.9 }] }));
        const res = await categorizeMerchants({ merchants, categories, getToken: async () => 'tok', fetchImpl });
        expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).merchants.map((m) => m.key)).toEqual(['lidl', 'xyz']);
        expect(res.map((r) => [r.key, r.category, r.selected])).toEqual([['lidl', 'Groceries', true], ['xyz', 'Other', false]]);
    });
    it('low confidence is listed but not preselected', async () => {
        const res = await categorizeMerchants({ merchants: [merchants[0]], categories, getToken: async () => 't', fetchImpl: reply(200, { results: [{ key: 'lidl', category: 'Dining', confidence: 0.6 }] }) });
        expect(res[0]).toMatchObject({ category: 'Dining', selected: false });
    });
    it('splits more than 50 merchants into several requests', async () => {
        const many = Array.from({ length: 120 }, (_, i) => ({ key: `m${i}`, name: `M${i}`, description: null, sampleItems: [], count: 1, transactionIds: [`t${i}`] }));
        const fetchImpl = vi.fn(async (_u, init) => {
            const keys = JSON.parse(init.body).merchants.map((m) => m.key);
            return { status: 200, ok: true, json: async () => ({ results: keys.map((key) => ({ key, category: 'Groceries', confidence: 0.9 })) }) };
        });
        const res = await categorizeMerchants({ merchants: many, categories, getToken: async () => 't', fetchImpl });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(res).toHaveLength(120);
    });
    it('maps 503 llm_not_configured to a notConfigured error', async () => {
        await expect(categorizeMerchants({ merchants, categories, getToken: async () => 't', fetchImpl: reply(503, { code: 'llm_not_configured' }) })).rejects.toMatchObject({ kind: 'notConfigured' });
        await expect(categorizeMerchants({ merchants, categories, getToken: async () => 't', fetchImpl: reply(429, {}) })).rejects.toMatchObject({ kind: 'rateLimit' });
        await expect(categorizeMerchants({ merchants, categories, getToken: async () => null, fetchImpl: reply(200, {}) })).rejects.toBeInstanceOf(AiError);
        online(false);
        await expect(categorizeMerchants({ merchants, categories, getToken: async () => 't', fetchImpl: reply(200, {}) })).rejects.toMatchObject({ kind: 'offline' });
    });
});

describe('applySuggestions', () => {
    it('recategorises every transaction of the accepted merchants in one batch and stores llm rules', async () => {
        for (const [id, m] of [['1', 'Lidl'], ['2', 'LIDL 12'], ['3', 'Xyz']]) await repo.createTransaction({ id, userId: U, merchant: m, total: 5, date: '2026-11-01', category: 'Other' });
        const sugg = [
            { key: 'lidl', name: 'Lidl', category: 'Groceries', selected: true, transactionIds: ['1', '2'] },
            { key: 'xyz', name: 'Xyz', category: 'Dining', selected: false, transactionIds: ['3'] },
        ];
        const applied = await applySuggestions(U, sugg);
        expect(applied.count).toBe(2);
        expect((await repo.getTransaction('1')).category).toBe('Groceries');
        expect((await repo.getTransaction('3')).category).toBe('Other');
        const rules = await repo.listRows('rules', U);
        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({ merchantKey: 'lidl', category: 'Groceries', source: 'llm' });
        await applied.undo();
        expect((await repo.getTransaction('2')).category).toBe('Other');
    });
    it('does not overwrite a user rule with a model guess', async () => {
        await repo.createRow('rules', U, { merchantKey: 'lidl', category: 'Dining', source: 'user', hitCount: 3 });
        await repo.createTransaction({ id: '1', userId: U, merchant: 'Lidl', total: 5, date: '2026-11-01', category: 'Other' });
        await applySuggestions(U, [{ key: 'lidl', name: 'Lidl', category: 'Groceries', selected: true, transactionIds: ['1'] }]);
        expect((await repo.listRows('rules', U))[0]).toMatchObject({ category: 'Dining', source: 'user' });
    });
});
