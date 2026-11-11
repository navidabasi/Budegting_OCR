import { describe, expect, it } from 'vitest';
import { allocationsOf, changeBetween, comparableUnitPrices, coverage, productKey, recurringProducts, spendByCategory, spendByMerchant, spendBySubcategory, unitPriceOf } from '../itemAnalysis';
import { monthTotals } from '../money';
import { comparablePeriods, inPeriod, periodProgress, previousMonthRange, toRange } from '../period';
import { applyItemRules, bulkPatches, decodeRuleValue, encodeRuleValue, itemRuleKey, matchItemRule, previewBulkItemChange } from '../itemRules';

const tx = (id, merchant, total, date, extra = {}) => ({ id, merchant, total, currency: 'EUR', date, category: 'Groceries', transactionType: 'expense', lineItems: [], ...extra });
const line = (name, price, category = 'Groceries', subcategory = null, extra = {}) => ({ name, price, quantity: 1, category, subcategory, ...extra });
const NOV = '2026-11';

describe('case 3: verified total with unresolved items -> correct totals, visible coverage', () => {
    const txs = [
        // total confirmed by hand (50), items only partly read: 2 lines (one unreadable)
        tx('a', 'Lidl', 50, '2026-11-03', { lineItems: [line('Latte', 20, 'Groceries', 'dairy'), line('???', null)] }),
        // fully itemised receipt
        tx('b', 'Conad', 30, '2026-11-05', { lineItems: [line('Pasta', 30, 'Groceries', 'pantry')] }),
        // no item detail at all (historical receipt)
        tx('c', 'Esselunga', 20, '2026-11-07'),
    ];
    it('spending totals use receipt totals only', () => {
        expect(monthTotals(txs, NOV).spent).toBe(100);
    });
    it('coverage states how much is itemised and how much is unknown', () => {
        const c = coverage(txs, NOV, { category: 'Groceries' });
        expect(c).toMatchObject({ total: 100, itemised: 50, unknown: 50, receipts: 3, receiptsWithItems: 2 });
        expect(c.share).toBe(0.5);
    });
    it('category analysis from items adds up to the receipt totals (unallocated stays visible)', () => {
        const cats = spendByCategory(txs, NOV);
        expect(cats).toHaveLength(1);
        expect(cats[0]).toMatchObject({ key: 'Groceries', total: 100, itemised: 50, unallocated: 50 });
        const subs = spendBySubcategory(txs, NOV, { category: 'Groceries' });
        expect(Object.fromEntries(subs.map((s) => [s.key, s.total]))).toEqual({ unknown: 50, dairy: 20, pantry: 30 });
        expect(subs.find((s) => s.key === 'unknown').unallocated).toBe(50);
    });
    it('every row leads back to the receipts and lines', () => {
        const dairy = spendBySubcategory(txs, NOV, { category: 'Groceries' }).find((s) => s.key === 'dairy');
        expect(dairy.refs).toEqual([expect.objectContaining({ txId: 'a', name: 'Latte', amount: 20, merchant: 'Lidl' })]);
    });
});

describe('case 4: mixed supermarket receipt -> correct split, drilldown, no double count', () => {
    const receipt = tx('m', 'Esselunga', 62.4, '2026-11-08', {
        lineItems: [
            line('Mele', 5.2, 'Groceries', 'produce'),
            line('Yogurt', 3.6, 'Groceries', 'dairy'),
            line('Pasta', 4, 'Groceries', 'pantry'),
            line('Pile AA', 8.9, 'Shopping'),
            line('Shampoo', 6.5, 'Personal care'),
            line('Sconto tessera', -3, 'Groceries', null, { discount: 3 }),
        ],
    });
    // other receipt in the same month so the total is not just this one
    const other = tx('o', 'Lidl', 10, '2026-11-09');
    it('splits the one receipt across categories and the remainder stays with the receipt category', () => {
        const cats = Object.fromEntries(spendByCategory([receipt], NOV).map((c) => [c.key, c.total]));
        // groceries: 5.2 + 3.6 + 4 - 3 (discount line) + 37.2 (the part of the receipt no line explains)
        expect(cats).toEqual({ Groceries: 47, Shopping: 8.9, 'Personal care': 6.5 });
    });
    it('the allocation rows add up to exactly the receipt total (nothing counted twice, nothing lost)', () => {
        const rows = allocationsOf(receipt);
        const sum = rows.reduce((s, r) => s + r.amount, 0);
        expect(Math.round(sum * 100) / 100).toBe(62.4);
        expect(rows.filter((r) => r.unallocated)).toHaveLength(1);
        expect(rows.find((r) => r.unallocated).amount).toBeCloseTo(37.2, 2);
    });
    it('spending total is the receipt total; the item view sums to the same number', () => {
        const spent = monthTotals([receipt, other], NOV).spent;
        const viaItems = spendByCategory([receipt, other], NOV).reduce((s, c) => s + c.total, 0);
        expect(spent).toBe(72.4);
        expect(Math.round(viaItems * 100) / 100).toBe(spent);
    });
    it('merchant ranking uses receipt totals, not items', () => {
        const ranking = spendByMerchant([receipt, other], NOV);
        expect(ranking.map((r) => [r.name, r.total])).toEqual([['Esselunga', 62.4], ['Lidl', 10]]);
        expect(ranking[0].refs[0]).toMatchObject({ txId: 'm', amount: 62.4 });
    });
    it('a foreign-currency receipt is analysed in base currency (amountBase scaling)', () => {
        const usd = tx('u', 'Shop', 100, '2026-11-02', { currency: 'USD', amountBase: 90, baseCurrency: 'EUR', lineItems: [line('a', 60, 'Groceries', 'pantry')] });
        const cats = spendByCategory([usd], NOV)[0];
        expect(cats.total).toBe(90);
        expect(cats.itemised).toBe(54);
    });
    it('planned/unpaid expenses and transfers are not spending', () => {
        const planned = tx('p', 'Rent', 600, '2026-11-01', { trackingData: { isTracked: true, status: 'open' } });
        const transfer = tx('t', 'To savings', 100, '2026-11-01', { transactionType: 'transfer' });
        expect(spendByMerchant([planned, transfer], NOV)).toEqual([]);
    });
});

describe('recurring products and comparable unit prices', () => {
    const milk = (id, date, price, extra) => tx(id, 'Lidl', price + 5, date, { lineItems: [line('Latte intero 1L', price, 'Groceries', 'dairy', extra)] });
    const txs = [milk('1', '2026-11-01', 1.2, { unit: 'l', quantity: 1 }), milk('2', '2026-11-08', 1.3, { unit: 'l', quantity: 1 }), milk('3', '2026-11-15', 1.5, { unit: 'l', quantity: 1 })];
    it('groups the same product across receipts cautiously (units and digits ignored, different products stay apart)', () => {
        expect(productKey('Latte intero 1L')).toBe('latte intero');
        expect(productKey('LATTE INTERO 500 ml')).toBe('latte intero');
        expect(productKey('Latte di soia')).not.toBe('latte intero');
        const r = recurringProducts(txs, NOV);
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ receipts: 3, count: 3, total: 4 });
        expect(recurringProducts(txs, NOV, { minReceipts: 4 })).toEqual([]);
    });
    it('compares unit prices only when units match', () => {
        const [u] = comparableUnitPrices(txs, NOV);
        expect(u).toMatchObject({ comparable: true, base: 'l', first: 1.2, latest: 1.5, min: 1.2, max: 1.5 });
        expect(u.changePct).toBeCloseTo(25, 5);
        // the same product sold by the litre and by the piece: not comparable, no numbers invented
        const mixed = [...txs, tx('4', 'Conad', 3, '2026-11-20', { lineItems: [line('Latte intero 1L', 1.4, 'Groceries', 'dairy', { unit: 'pc', quantity: 1 })] })];
        const [m] = comparableUnitPrices(mixed, NOV);
        expect(m.comparable).toBe(false);
        expect(m.latest).toBeNull();
    });
    it('converts g/ml/cl to the base unit and prefers a printed unit price over a derived one', () => {
        expect(unitPriceOf({ unit: 'g', unitPrice: 0.002, amount: 1, quantity: 500 })).toMatchObject({ base: 'kg', value: 2, derived: false });
        expect(unitPriceOf({ unit: 'ml', amount: 1.2, quantity: 1000 })).toMatchObject({ base: 'l', value: 1.2, derived: true });
        expect(unitPriceOf({ amount: 3, quantity: 1 })).toBeNull(); // no unit: never guessed
    });
});

describe('change between comparable periods', () => {
    const txs = [
        tx('a', 'Lidl', 40, '2026-10-03', { lineItems: [line('x', 40, 'Groceries', 'dairy')] }),
        tx('b', 'Lidl', 60, '2026-10-28', { lineItems: [line('y', 60, 'Groceries', 'pantry')] }),
        tx('c', 'Lidl', 70, '2026-11-02', { lineItems: [line('z', 70, 'Groceries', 'dairy')] }),
    ];
    it('active period vs the same elapsed days of the previous one', () => {
        const today = new Date(2026, 10, 10); // 10 Nov: 10 days elapsed
        const cmp = comparablePeriods('2026-11', today, previousMonthRange);
        expect(cmp.basis).toBe('elapsed');
        expect(cmp.current).toEqual({ start: '2026-11-01', end: '2026-11-10' });
        expect(cmp.previous).toEqual({ start: '2026-10-01', end: '2026-10-10' });
        const ch = changeBetween(txs, cmp.current, cmp.previous, { by: 'subcategory', category: 'Groceries' });
        expect(ch).toMatchObject({ current: 70, previous: 40, delta: 30 });
        expect(ch.rows[0]).toMatchObject({ key: 'dairy', delta: 30 });
    });
    it('completed vs completed', () => {
        const cmp = comparablePeriods('2026-10', new Date(2026, 10, 10), (r) => ({ start: '2026-09-01', end: '2026-09-30' }));
        expect(cmp.basis).toBe('completed');
        expect(changeBetween(txs, cmp.current, cmp.previous, { by: 'merchant' }).current).toBe(100);
    });
    it('period helpers: inclusive bounds, progress, month ranges', () => {
        expect(toRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
        expect(inPeriod('2026-11-30', '2026-11')).toBe(true);
        expect(inPeriod('2026-12-01', '2026-11')).toBe(false);
        expect(periodProgress({ start: '2026-10-12', end: '2026-11-11' }, new Date(2026, 10, 11))).toMatchObject({ day: 31, days: 31, daysLeft: 1, state: 'current' });
    });
});

describe('case 8: one item recategorised -> no unrelated history changes; bulk rule needs scope and is reversible', () => {
    const history = [
        tx('r1', 'Lidl', 10, '2026-10-01', { lineItems: [{ v: 2, id: 'i1', name: 'Latte intero 1L', amount: 1.2, price: 1.2, category: 'Groceries', subcategory: null, reviewStatus: 'auto', userEdited: [] }] }),
        tx('r2', 'Conad', 10, '2026-10-08', { lineItems: [{ v: 2, id: 'i2', name: 'LATTE INTERO 500ml', amount: 0.8, price: 0.8, category: 'Groceries', subcategory: null, reviewStatus: 'auto', userEdited: [] }] }),
        tx('r3', 'Coop', 10, '2026-10-15', { lineItems: [{ v: 2, id: 'i3', name: 'Latte intero', amount: 1.1, price: 1.1, category: 'Groceries', subcategory: 'beverages', reviewStatus: 'confirmed', userEdited: ['category', 'subcategory'] }] }),
        tx('r4', 'Lidl', 10, '2026-10-20', { lineItems: [{ v: 2, id: 'i4', name: 'Latte di soia', amount: 2, price: 2, category: 'Groceries', subcategory: null, reviewStatus: 'auto', userEdited: [] }] }),
    ];
    it('the preview lists exactly the lines that would change and writes nothing', () => {
        const preview = previewBulkItemChange(history, { name: 'Latte intero 1L', category: 'Groceries', subcategory: 'dairy', excludeTxId: 'r1' });
        expect(preview.map((p) => p.itemId).sort()).toEqual(['i2']); // r3 was categorised by the user, r4 is another product
        expect(preview[0]).toMatchObject({ from: { subcategory: null }, to: { subcategory: 'dairy' } });
        expect(history[1].lineItems[0].subcategory).toBeNull(); // untouched
        expect(previewBulkItemChange(history, { name: 'Latte intero 1L', category: 'Groceries', subcategory: 'dairy', includeEdited: true, excludeTxId: 'r1' }).map((p) => p.itemId).sort()).toEqual(['i2', 'i3']);
    });
    it('the patches touch only the previewed lines, mark them as user edits, and keep the previous values for undo', () => {
        const preview = previewBulkItemChange(history, { name: 'Latte intero 1L', category: 'Groceries', subcategory: 'dairy' });
        const patches = bulkPatches(history, preview);
        expect(patches.map((p) => p.id).sort()).toEqual(['r1', 'r2']);
        expect(patches[0].patch.lineItems[0]).toMatchObject({ subcategory: 'dairy', userEdited: expect.arrayContaining(['category']) });
        expect(history.find((t) => t.id === 'r4')).toEqual(history[3]); // unrelated receipt not in the patch set
    });
    it('item rules: key, encoding, matching and applying to new lines without overriding the user', () => {
        expect(itemRuleKey('Latte intero 1L')).toBe('item:latte intero');
        expect(decodeRuleValue(encodeRuleValue({ category: 'Groceries', subcategory: 'dairy' }))).toEqual({ category: 'Groceries', subcategory: 'dairy' });
        expect(decodeRuleValue('Shopping')).toEqual({ category: 'Shopping', subcategory: null });
        const rules = [{ merchantKey: 'item:latte intero', category: 'Groceries::dairy' }, { merchantKey: 'lidl', category: 'Groceries' }];
        expect(matchItemRule(rules, 'LATTE INTERO 1L')).toMatchObject({ category: 'Groceries', subcategory: 'dairy' });
        expect(matchItemRule(rules, 'Pane')).toBeNull();
        const applied = applyItemRules(
            [{ name: 'Latte intero 1L', category: 'Shopping', userEdited: [] }, { name: 'Latte intero', category: 'Shopping', userEdited: ['category'] }],
            rules
        );
        expect(applied[0]).toMatchObject({ category: 'Groceries', subcategory: 'dairy' });
        expect(applied[1].category).toBe('Shopping'); // the user's own correction wins
    });
});
