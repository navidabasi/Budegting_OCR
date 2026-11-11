import { describe, expect, it } from 'vitest';
import { assignDifference, editItem, itemsFromExtraction, mergeEditedItems, normalizeItem, normalizeItems, reconcile, serializeItem, uncertainFields } from '../receiptItems';
import { GROCERY_SUBCATEGORIES, canonicalSubcategory, subcategoriesFor } from '../categoryNames';

describe('item normaliser reads old items unchanged', () => {
    const legacy = { name: 'Latte intero 1L', quantity: 1, price: 1.19, category: 'Groceries' };
    it('maps legacy {name, quantity, price, category} to v2 without inventing anything', () => {
        const it = normalizeItem(legacy, { index: 0, receiptCategory: 'Groceries' });
        expect(it).toMatchObject({ v: 2, name: 'Latte intero 1L', amount: 1.19, quantity: 1, category: 'Groceries', rawText: null, subcategory: null, reviewStatus: 'confirmed', userEdited: [] });
        expect(it.unit).toBeUndefined();
        expect(it.unitPrice).toBeUndefined();
        expect(it.id).toMatch(/^l-/);
        expect(normalizeItem(legacy, { index: 0 }).id).toBe(it.id); // stable id across reads
    });
    it('legacy items without a price or name need review; missing category falls back to the receipt category', () => {
        expect(normalizeItem({ name: 'x', price: null }).reviewStatus).toBe('needs_review');
        expect(normalizeItem({ name: '', price: 2 }).reviewStatus).toBe('needs_review');
        expect(normalizeItem({ name: 'x', price: 2 }, { receiptCategory: 'Shopping' }).category).toBe('Shopping');
    });
    it('keeps old categories of the pre-v14 names readable and tolerates garbage', () => {
        expect(normalizeItems([null, 3, 'x', {}]).length).toBe(4);
        expect(normalizeItems(undefined)).toEqual([]);
    });
    it('serialisation writes v2 and the legacy price/quantity so older readers keep working', () => {
        const s = serializeItem({ v: 2, id: 'a', name: 'Pane', amount: 2.5, category: 'Groceries', subcategory: 'bakery', unit: 'kg', quantity: 0.5, unitPrice: 5, reviewStatus: 'auto' });
        expect(s).toMatchObject({ v: 2, price: 2.5, amount: 2.5, quantity: 0.5, unit: 'kg', unitPrice: 5, subcategory: 'bakery' });
        expect(normalizeItem(s)).toMatchObject({ id: 'a', amount: 2.5, subcategory: 'bakery' }); // round trip
    });
    it('rounds amounts to cents and ignores unknown units', () => {
        expect(normalizeItem({ name: 'a', amount: '1,5', unit: 'bottles' })).toMatchObject({ amount: 1.5 });
        expect(normalizeItem({ name: 'a', amount: 1, unit: 'bottles' }).unit).toBeUndefined();
    });
});

describe('extraction -> items', () => {
    it('keeps printed fields, flags uncertain lines, never invents', () => {
        const items = itemsFromExtraction(
            [
                { rawText: 'BANANE 0,812 KG', name: 'Banane', price: 1.29, quantity: 0.812, unit: 'kg', unitPrice: 1.59, category: 'Groceries', subcategory: 'produce' },
                { name: 'Pane', price: 2, quantity: 1, category: null },
                { name: '???', price: null },
            ],
            { category: 'Groceries', confidence: 0.9 }
        );
        expect(items[0]).toMatchObject({ rawText: 'BANANE 0,812 KG', unit: 'kg', unitPrice: 1.59, subcategory: 'produce', reviewStatus: 'auto' });
        expect(items[1].category).toBe('Groceries');
        expect(items[1].unit).toBeUndefined();
        expect(items[2].reviewStatus).toBe('needs_review');
        expect(uncertainFields(items[2])).toContain('amount');
        expect(uncertainFields(items[0])).toEqual([]);
        expect(new Set(items.map((i) => i.id)).size).toBe(3);
    });
    it('a low-confidence reading flags every line for review', () => {
        const items = itemsFromExtraction([{ name: 'a', price: 1 }], { confidence: 0.4 });
        expect(items[0].reviewStatus).toBe('needs_review');
    });
});

describe('editing', () => {
    it('records only the changed fields in userEdited and confirms the item', () => {
        const it = normalizeItem({ v: 2, id: 'a', name: 'Latte', amount: 1.2, category: 'Groceries', reviewStatus: 'needs_review' });
        const next = editItem(it, { category: 'Shopping', name: 'Latte' });
        expect(next).toMatchObject({ category: 'Shopping', reviewStatus: 'confirmed', userEdited: ['category'] });
        expect(editItem(next, { category: 'Shopping' })).toEqual(next); // no-op stays a no-op
    });
    it('Quick Add rows keep untouched items exactly and edit changed ones', () => {
        const stored = [
            { v: 2, id: 'a', name: 'Latte', amount: 1.2, price: 1.2, category: 'Groceries', subcategory: 'dairy', rawText: 'LATTE INT', unit: 'l', reviewStatus: 'auto', userEdited: [] },
            { v: 2, id: 'b', name: 'Pane', amount: 2, price: 2, category: 'Groceries', reviewStatus: 'auto', userEdited: [] },
        ];
        const out = mergeEditedItems(stored, [{ id: 'a', name: 'Latte', price: '1.2' }, { id: 'b', name: 'Pane integrale', price: '2' }, { name: 'Sacchetto', price: '0,10' }, { name: '', price: '5' }], { category: 'Groceries' });
        expect(out).toHaveLength(3);
        expect(out[0]).toEqual(normalizeItem(stored[0])); // subcategory, rawText and unit survive
        expect(out[1]).toMatchObject({ name: 'Pane integrale', userEdited: ['name'], reviewStatus: 'confirmed' });
        expect(out[2]).toMatchObject({ name: 'Sacchetto', amount: 0.1, category: 'Groceries' });
    });
});

describe('reconciliation (receipt total vs items)', () => {
    const base = { total: 50, category: 'Groceries' };
    it('no items: nothing explained, total untouched', () => {
        expect(reconcile({ ...base, lineItems: [] })).toMatchObject({ status: 'no_items', unallocated: 50, itemsSum: 0, coverage: 0, hasItems: false });
    });
    it('shortfall: items below the total leave an explicit unallocated amount', () => {
        const r = reconcile({ ...base, lineItems: [{ name: 'a', price: 30 }, { name: 'b', price: 10.5 }] });
        expect(r).toMatchObject({ status: 'shortfall', itemsSum: 40.5, unallocated: 9.5 });
        expect(r.coverage).toBeCloseTo(0.81, 2);
    });
    it('excess: items above the total give a negative unallocated amount', () => {
        expect(reconcile({ ...base, lineItems: [{ name: 'a', price: 52 }] })).toMatchObject({ status: 'excess', unallocated: -2 });
    });
    it('unreadable lines are counted but add nothing', () => {
        const r = reconcile({ ...base, lineItems: [{ name: 'a', price: 20 }, { name: '???', price: null }] });
        expect(r).toMatchObject({ itemsSum: 20, unallocated: 30, unknownCount: 1 });
    });
    it('within a cent counts as complete (float noise never shows a phantom difference)', () => {
        expect(reconcile({ total: 0.3, lineItems: [{ name: 'a', price: 0.1 }, { name: 'b', price: 0.2 }] })).toMatchObject({ status: 'complete', unallocated: 0 });
    });
    it('"assign the difference" adds one explicit line so items add up to the total, and is idempotent', () => {
        const receipt = { ...base, lineItems: [{ name: 'a', price: 30 }] };
        const items = assignDifference(receipt, { name: 'Bags', category: 'Shopping' });
        expect(items).toHaveLength(2);
        expect(items[1]).toMatchObject({ name: 'Bags', amount: 20, category: 'Shopping', reviewStatus: 'confirmed', rawText: null });
        expect(reconcile({ ...receipt, lineItems: items })).toMatchObject({ status: 'complete', unallocated: 0 });
        expect(assignDifference({ ...receipt, lineItems: items }, {})).toHaveLength(2);
        const excess = assignDifference({ ...base, lineItems: [{ name: 'a', price: 55 }] }, { name: 'Discount' });
        expect(excess[1].amount).toBe(-5);
    });
});

describe('grocery subcategories', () => {
    it('default list, user additions and model-output canonicalisation', () => {
        expect(GROCERY_SUBCATEGORIES).toEqual(['produce', 'dairy', 'meat_fish', 'pantry', 'snacks', 'beverages', 'frozen', 'bakery', 'other']);
        expect(subcategoriesFor('Groceries', { Groceries: ['Pet food', 'dairy'] })).toEqual([...GROCERY_SUBCATEGORIES, 'Pet food']);
        expect(subcategoriesFor('Shopping')).toEqual([]);
        expect(canonicalSubcategory('Meat/Fish')).toBe('meat_fish');
        expect(canonicalSubcategory('drinks')).toBeNull();
    });
});
