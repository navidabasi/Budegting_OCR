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
    fetchOne: vi.fn(async () => null),
    fetchSince: vi.fn(async () => []),
    fetchIds: vi.fn(async () => []),
    fetchPage: vi.fn(async () => ({ rows: [], next: null })),
    PULL_PAGE: 50,
}));
vi.mock('../../data/queryClient', () => ({ notifyDataChanged: vi.fn(), queryClient: {} }));

import { db, openDb } from '../../data/db';
import * as repo from '../../data/repo';
import { applyProposal, loadLog, localProposals, proposalHref, removableAsDuplicate, resolveProposals, undoEntry } from '../aiActions';

const U = 'u1';
const CATS = ['Groceries', 'Fuel', 'Dining', 'Other'];
const mk = (id, merchant, category, extra = {}) => repo.createTransaction({ id, userId: U, merchant, total: 30, date: '2026-11-05', category, ...extra });
const refs = { R1: { txId: 'a' }, R2: { txId: 'b' } };

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
});

describe('proposals from the model are re-checked against the records on the device', () => {
    it('keeps valid recategorise/duplicate/recurring proposals and drops invalid ones', async () => {
        await mk('a', 'Q8', 'Other');
        await mk('b', 'Q8', 'Other', { createdAt: 'x' });
        const txs = await repo.listTransactions(U);
        const raw = [
            { type: 'recategorise', ref: 'R1', category: 'Fuel' },
            { type: 'recategorise', ref: 'R1', category: 'Spaceships' }, // not a category of the user
            { type: 'recategorise', ref: 'R9', category: 'Fuel' }, // unknown record
            { type: 'mark_duplicate', ref: 'R1', toRef: 'R2' },
            { type: 'create_recurring', ref: 'R2', frequency: 'monthly' },
            { type: 'pay_bill', ref: 'R1' },
        ];
        const out = resolveProposals(raw, refs, txs, { categories: CATS });
        expect(out.map((p) => p.type)).toEqual(['recategorise', 'mark_duplicate', 'create_recurring']);
    });
    it('never proposes removing a photographed, shared or settled record', async () => {
        await mk('a', 'Q8', 'Other', { imagePath: 'u1/a.jpg' });
        await mk('b', 'Q8', 'Other', { splitData: { v: 2, payer: 'me', participants: [], method: 'equal', shares: {} } });
        const txs = await repo.listTransactions(U);
        expect(removableAsDuplicate(txs.find((t) => t.id === 'a'), txs)).toBe(false);
        expect(removableAsDuplicate(txs.find((t) => t.id === 'b'), txs)).toBe(false);
        expect(resolveProposals([{ type: 'mark_duplicate', ref: 'R1', toRef: 'R2' }], refs, txs, { categories: CATS })).toEqual([]);
    });
    it('prepare_correction only links to the record', async () => {
        await mk('a', 'Q8', 'Other');
        const [p] = resolveProposals([{ type: 'prepare_correction', ref: 'R1' }], refs, await repo.listTransactions(U), { categories: CATS });
        expect(proposalHref(p)).toBe('/receipts/a');
        await expect(applyProposal(U, p)).rejects.toThrow();
        expect(await loadLog(U)).toEqual([]);
    });
});

describe('apply and undo (recorded, restart-safe)', () => {
    it('recategorise changes only the listed records and is undone from the history', async () => {
        await mk('a', 'Q8', 'Other');
        await mk('b', 'Q8', 'Other');
        await mk('c', 'Bar', 'Dining');
        const [p] = resolveProposals([{ type: 'recategorise', ref: 'R1', category: 'Fuel' }], refs, await repo.listTransactions(U), { categories: CATS });
        const entry = await applyProposal(U, p);
        expect((await repo.getTransaction('a')).category).toBe('Fuel');
        expect((await repo.getTransaction('b')).category).toBe('Other'); // not listed: untouched
        expect((await repo.getTransaction('c')).category).toBe('Dining');
        const log = await loadLog(U);
        expect(log[0]).toMatchObject({ id: entry.id, type: 'recategorise', status: 'applied', count: 1 });

        await undoEntry(U, entry.id);
        expect((await repo.getTransaction('a')).category).toBe('Other');
        expect((await loadLog(U))[0].status).toBe('undone');
        expect(await undoEntry(U, entry.id)).toBeNull(); // not twice
    });

    it('mark duplicate removes one record and brings it back unchanged on undo', async () => {
        await mk('a', 'Coffee', 'Dining', { notes: 'keep this' });
        await mk('b', 'Coffee', 'Dining');
        const [p] = resolveProposals([{ type: 'mark_duplicate', ref: 'R1', toRef: 'R2' }], refs, await repo.listTransactions(U), { categories: CATS });
        const entry = await applyProposal(U, p);
        expect(await repo.getTransaction('a')).toBeNull();
        expect(await repo.getTransaction('b')).not.toBeNull();
        await undoEntry(U, entry.id);
        const back = await repo.getTransaction('a');
        expect(back).toMatchObject({ id: 'a', merchant: 'Coffee', total: 30, notes: 'keep this', date: '2026-11-05' });
    });

    it('create recurring sets what Detail > Repeats saves and undo clears it', async () => {
        await mk('a', 'Netflix', 'Entertainment');
        const [p] = resolveProposals([{ type: 'create_recurring', ref: 'R1', frequency: 'monthly' }], refs, await repo.listTransactions(U), { categories: CATS });
        const entry = await applyProposal(U, p);
        expect((await repo.getTransaction('a')).recurringData).toMatchObject({ isActive: true, frequency: 'monthly', nextDueDate: '2026-12-05' });
        await undoEntry(U, entry.id);
        expect((await repo.getTransaction('a')).recurringData ?? null).toBeNull();
    });

    it('the history survives a reopened database', async () => {
        await mk('a', 'Q8', 'Other');
        const [p] = resolveProposals([{ type: 'recategorise', ref: 'R1', category: 'Fuel' }], refs, await repo.listTransactions(U), { categories: CATS });
        await applyProposal(U, p);
        db.close();
        await openDb({ force: true });
        expect((await loadLog(U))).toHaveLength(1);
    });
});

describe('local proposals', () => {
    it('groups uncategorised records by merchant using the categorizer and finds duplicates', async () => {
        await mk('a', 'Q8', 'Other');
        await mk('b', 'Q8', 'Other', { date: '2026-11-07' });
        await mk('c', 'Coffee', 'Dining', { total: 4.2 });
        await mk('d', 'Coffee', 'Dining', { total: 4.2 });
        const txs = await repo.listTransactions(U);
        const ps = localProposals(txs, { period: '2026-11', today: '2026-11-20', suggest: (t) => (t.merchant === 'Q8' ? 'Fuel' : null), categories: CATS });
        const rec = ps.find((p) => p.type === 'recategorise');
        expect(rec.records.map((r) => r.id).sort()).toEqual(['a', 'b']);
        expect(rec.category).toBe('Fuel');
        expect(ps.filter((p) => p.type === 'mark_duplicate')).toHaveLength(1);
    });
});
