import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));
import { db, openDb } from '../../data/db';
import { createTransaction, getTransaction } from '../../data/repo';
import { applyBulkItemChange, changeItem, saveItemRule } from '../itemCorrections';
import { listRows } from '../../data/repo';
import { previewBulkItemChange } from '../../utils/itemRules';
import { serializeItems } from '../../utils/receiptItems';

const U = 'u1';
const milk = (id, amount) => serializeItems([{ v: 2, id, name: 'Latte intero 1L', amount, category: 'Groceries', reviewStatus: 'auto', userEdited: [] }]);

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
});

describe('item corrections never leak into history', () => {
    it('changing one line changes that line of that receipt only (no rule, no other receipt)', async () => {
        const a = await createTransaction({ userId: U, merchant: 'Lidl', total: 10, date: '2026-10-01', category: 'Groceries', lineItems: milk('i1', 1.2) });
        const b = await createTransaction({ userId: U, merchant: 'Conad', total: 10, date: '2026-10-08', category: 'Groceries', lineItems: milk('i2', 0.9) });
        const txA = await getTransaction(a);
        await changeItem(txA, 'i1', { subcategory: 'dairy' });
        expect((await getTransaction(a)).lineItems[0]).toMatchObject({ subcategory: 'dairy', userEdited: ['subcategory'], reviewStatus: 'confirmed' });
        expect((await getTransaction(b)).lineItems[0].subcategory ?? null).toBeNull();
        expect(await listRows('rules', U)).toEqual([]);
    });

    it('a rule for future purchases is stored as an item rule and rewrites nothing', async () => {
        const b = await createTransaction({ userId: U, merchant: 'Conad', total: 10, date: '2026-10-08', category: 'Groceries', lineItems: milk('i2', 0.9) });
        await saveItemRule(U, 'Latte intero 1L', { category: 'Groceries', subcategory: 'dairy' });
        const [rule] = await listRows('rules', U);
        expect(rule).toMatchObject({ merchantKey: 'item:latte intero', category: 'Groceries::dairy', source: 'user' });
        expect((await getTransaction(b)).lineItems[0].subcategory ?? null).toBeNull();
        await saveItemRule(U, 'LATTE INTERO 500ml', { category: 'Groceries', subcategory: 'beverages' }); // same product: updates the one rule
        const rules = await listRows('rules', U);
        expect(rules).toHaveLength(1);
        expect(rules[0].category).toBe('Groceries::beverages');
    });

    it('a previewed bulk change applies to the previewed lines and is fully reversible', async () => {
        const ids = [];
        for (const [i, m] of ['Lidl', 'Conad', 'Coop'].entries()) ids.push(await createTransaction({ userId: U, merchant: m, total: 10, date: `2026-10-0${i + 1}`, category: 'Groceries', lineItems: milk(`i${i}`, 1) }));
        await createTransaction({ userId: U, merchant: 'Bar', total: 3, date: '2026-10-05', category: 'Dining' });
        const all = await Promise.all(ids.map(getTransaction));
        const preview = previewBulkItemChange(all, { name: 'Latte intero 1L', category: 'Groceries', subcategory: 'dairy', excludeTxId: ids[0] });
        expect(preview).toHaveLength(2);
        const r = await applyBulkItemChange(all, preview);
        expect(r.count).toBe(2);
        expect((await getTransaction(ids[0])).lineItems[0].subcategory ?? null).toBeNull(); // the receipt that was not in the preview
        expect((await getTransaction(ids[1])).lineItems[0].subcategory).toBe('dairy');
        expect((await getTransaction(ids[2])).lineItems[0].subcategory).toBe('dairy');
        await r.undo();
        expect((await getTransaction(ids[1])).lineItems[0].subcategory ?? null).toBeNull();
        expect((await getTransaction(ids[2])).lineItems[0].userEdited).toEqual([]);
    });
});
