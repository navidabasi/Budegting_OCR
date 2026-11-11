import { describe, it, expect, vi } from 'vitest';
import { applyImport, buildPreview, initialState, parseFor, reducer, summarize, toTransaction } from '../importFlow';

const REVOLUT = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-11-08 12:00:00,2026-11-08 12:01:00,LIDL 0231 TORINO,-23.47,0.00,EUR,COMPLETED,100.00
CARD_PAYMENT,Current,2026-11-07 09:00:00,2026-11-07 09:01:00,Pastéis de Belém,-11.20,0.00,EUR,COMPLETED,120.00
TOPUP,Current,2026-11-06 09:00:00,2026-11-06 09:01:00,Top-up,200.00,0.00,EUR,COMPLETED,320.00
CARD_PAYMENT,Current,2026-11-05 09:00:00,2026-11-05 09:01:00,Reverted shop,-5.00,0.00,EUR,REVERTED,320.00
`;
const trips = [{ id: 'trip', kind: 'trip', name: 'Lisbon', startsOn: '2026-11-06', endsOn: '2026-11-09' }];
const scanned = [{ id: 'r1', date: '2026-11-08', merchant: 'Lidl', total: 23.47, transactionType: 'expense', imagePath: 'x.jpg', lineItems: [{ name: 'Latte' }] }];
const names = ['Groceries', 'Dining', 'Other'];

describe('buildPreview', () => {
    it('suggests categories, marks duplicates of scanned receipts (merge by default) and attaches trip rows', async () => {
        const { rows } = await parseFor('revolut', REVOLUT);
        expect(rows).toHaveLength(3); // reverted skipped
        const items = buildPreview({ rows, existing: scanned, trips, rules: [], names });
        const lidl = items.find((i) => i.row.description.startsWith('LIDL'));
        expect(lidl.category).toBe('Groceries');
        expect(lidl.action).toBe('merge');
        expect(lidl.duplicate.existing.id).toBe('r1');
        const cafe = items.find((i) => i.row.description.startsWith('Past'));
        expect(cafe).toMatchObject({ tripId: 'trip', tripName: 'Lisbon', action: 'import' });
        expect(summarize(items)).toMatchObject({ merge: 1, import: 2 });
    });
});

describe('applyImport (idempotent)', () => {
    it('creates rows with importRef, merges into the receipt, and a second run adds nothing', async () => {
        const store = [...scanned];
        const createTransaction = vi.fn(async (tx) => { store.push({ id: `n${store.length}`, ...tx }); });
        const updateTransaction = vi.fn(async (id, patch) => { Object.assign(store.find((t) => t.id === id), patch); });
        const run = async () => {
            const { rows } = await parseFor('revolut', REVOLUT);
            const items = buildPreview({ rows, existing: store, trips, rules: [], names });
            return applyImport({ items, accountId: 'acc', userId: 'u', createTransaction, updateTransaction });
        };
        const first = await run();
        expect(first).toMatchObject({ created: 2, merged: 1, skipped: 0 });
        expect(store.every((t) => t.importRef)).toBe(true);
        const receipt = store.find((t) => t.id === 'r1');
        expect(receipt).toMatchObject({ accountId: 'acc', imagePath: 'x.jpg' });
        expect(receipt.lineItems).toHaveLength(1);
        const cafe = store.find((t) => /Past/.test(t.merchant));
        expect(cafe.groupId).toBe('trip');
        const second = await run();
        expect(second).toMatchObject({ created: 0, merged: 0, skipped: 3 });
        expect(store).toHaveLength(3);
    });
    it('inbound transfers land in the chosen account', async () => {
        const { rows } = await parseFor('revolut', REVOLUT);
        const item = buildPreview({ rows, existing: [], trips: [], rules: [], names }).find((i) => i.row.transactionType === 'transfer');
        expect(toTransaction(item, { accountId: 'acc' })).toMatchObject({ transactionType: 'transfer', accountId: null, toAccountId: 'acc', category: 'Transfer' });
    });
});

describe('wizard reducer', () => {
    it('walks account -> provider -> file -> preview -> done and can go back', () => {
        let s = initialState();
        expect(s.step).toBe('account');
        s = reducer(s, { type: 'ACCOUNT', accountId: 'a' });
        s = reducer(s, { type: 'PROVIDER', provider: 'revolut' });
        expect(s.step).toBe('file');
        s = reducer(s, { type: 'FILE', text: 'x', name: 'f.csv' });
        expect(s.step).toBe('file');
        s = reducer(s, { type: 'PARSED', items: [{ index: 0, action: 'import' }] });
        expect(s.step).toBe('preview');
        s = reducer(s, { type: 'SET_ACTION', index: 0, action: 'skip' });
        expect(s.items[0].action).toBe('skip');
        s = reducer(s, { type: 'BACK' });
        expect(s.step).toBe('file');
        s = reducer(s, { type: 'DONE', result: { created: 1 } });
        expect(s.step).toBe('done');
    });
    it('"other" goes through the column mapper; a preset account skips the first step', () => {
        let s = initialState({ accountId: 'a' });
        expect(s.step).toBe('provider');
        s = reducer(s, { type: 'PROVIDER', provider: 'other' });
        s = reducer(s, { type: 'FILE', text: 'x', name: 'f.csv' });
        expect(s.step).toBe('mapping');
        s = reducer(s, { type: 'PARSED', items: [] });
        s = reducer(s, { type: 'BACK' });
        expect(s.step).toBe('mapping');
    });
});

describe('generic provider', () => {
    it('parses with a mapping', async () => {
        const csv = 'Data;Descrizione;Importo\n08/11/2026;PAGAMENTO POS ESSELUNGA;-12,50\n';
        const { rows } = await parseFor('other', csv, { mapping: { date: 'Data', description: 'Descrizione', amount: 'Importo' } });
        expect(rows[0]).toMatchObject({ date: '2026-11-08', amount: 12.5, transactionType: 'expense' });
        expect(rows[0].importRef).toMatch(/^csv:/);
    });
});
