import { describe, expect, it, vi } from 'vitest';
import { buildEvidencePack, productComparison, reviewCandidates, routeQuestion, unsupportedFigures, validateAnswer } from '../evidencePack';
import { sendEvidenceChat } from '../chatApi';
import { comparablePeriods } from '../../utils/period';
import { monthPeriod } from '../../utils/payCycle';

const U = 'u';
const line = (id, name, amount, category, subcategory, extra = {}) => ({ v: 2, id, name, price: amount, amount, quantity: 1, category, subcategory, reviewStatus: 'confirmed', userEdited: [], ...extra });
let n = 0;
const tx = (merchant, total, category, date, extra = {}) => ({ id: `t${++n}`, userId: U, merchant, total, currency: 'EUR', category, date, notes: '', lineItems: [], transactionType: 'expense', createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z`, ...extra });

// Synthetic data. Period: November 2026, today = Nov 20. Previous comparable: Oct 1-20.
const NOV = monthPeriod('2026-11');
const TODAY = '2026-11-20';
const data = () => {
    n = 0;
    return [
        // current period (Nov 1-20)
        tx('Lidl', 40, 'Groceries', '2026-11-03', { lineItems: [line('a1', 'Latte intero 1L', 10, 'Groceries', 'dairy', { unit: 'l', quantity: 5 }), line('a2', 'Mele', 12, 'Groceries', 'produce', { unit: 'kg', quantity: 4 }), line('a3', 'Pile AA', 8, 'Shopping', null)] }), // 10 unallocated
        tx('Conad', 60, 'Groceries', '2026-11-10', { lineItems: [line('b1', 'Latte intero 1L', 12, 'Groceries', 'dairy', { unit: 'l', quantity: 5 }), line('b2', 'Pasta', 18, 'Groceries', 'pantry'), { ...line('b3', 'Pollo', null, 'Groceries', 'meat_fish'), amount: null, price: null, reviewStatus: 'needs_review' }] }), // 30 unallocated
        tx('Esselunga', 50, 'Groceries', '2026-11-15'), // no item detail
        tx('Bar Roma', 20, 'Dining', '2026-11-12'),
        tx('Pizzeria', 40, 'Dining', '2026-11-14', { splitData: { v: 2, payer: 'me', participants: [{ id: 'me', name: 'Me' }, { id: 'marta', name: 'Marta' }], method: 'equal', shares: { me: 2000, marta: 2000 } } }),
        // previous period (Oct)
        tx('Lidl', 30, 'Groceries', '2026-10-04', { lineItems: [line('c1', 'Latte intero 1L', 6, 'Groceries', 'dairy', { unit: 'l', quantity: 4 }), line('c2', 'Mele', 10, 'Groceries', 'produce', { unit: 'kg', quantity: 5 })] }), // 14 unallocated
        tx('Conad', 20, 'Groceries', '2026-10-09'),
        tx('Bar Roma', 10, 'Dining', '2026-10-12'),
        // outside both
        tx('Lidl', 99, 'Groceries', '2026-09-01'),
    ];
};
const base = (extra = {}) => ({ transactions: data(), period: NOV, today: TODAY, currency: 'EUR', people: [{ id: 'marta', name: 'Marta' }], ...extra });
const factsOf = (pack, kind) => pack.facts.filter((f) => f.kind === kind);

describe('routeQuestion: the brief examples go to deterministic builders', () => {
    it.each([
        ['What is my top supermarket this cycle?', 'top_merchant'],
        ['Where did my grocery money go?', 'grocery_breakdown'],
        ['what drove grocery spending', 'grocery_breakdown'],
        ['What explains the change versus the previous comparable period?', 'change'],
        ['Am I buying more or paying more per kg?', 'unit_price'],
        ['What do I owe and what am I owed?', 'owed'],
        ['Which records or recurring charges need review?', 'review'],
        ['How do my commitments affect my budgets and goals?', 'budgets_goals'],
        ['Tell me something', 'general'],
    ])('%s -> %s', (q, intent) => expect(routeQuestion(q)).toBe(intent));
});

describe('"what drove grocery spending" (brief section 12 case 10)', () => {
    const { pack, refs } = buildEvidencePack({ ...base(), question: 'what drove grocery spending' });

    it('states the right period, currency and basis', () => {
        expect(pack.intent).toBe('grocery_breakdown');
        expect(pack.period).toMatchObject({ kind: 'month', start: '2026-11-01', end: '2026-11-30', state: 'current', day: 20 });
        expect(pack.currency).toBe('EUR');
        expect(pack.basis).toBe('share');
        expect(pack.comparison).toMatchObject({ basis: 'elapsed', elapsedDays: 20 });
        expect(pack.comparison.current).toEqual({ start: '2026-11-01', end: '2026-11-20' });
        expect(pack.comparison.previous).toEqual({ start: '2026-10-01', end: '2026-10-20' });
    });

    it('computes category and subcategory totals from the calculation layer without double counting', () => {
        const total = factsOf(pack, 'category_total')[0];
        expect(total).toMatchObject({ category: 'Groceries', amount: 150, count: 3, groceryLines: 142, otherCategoryLines: 8 }); // receipts 40 + 60 + 50; the 8 EUR batteries are not grocery; September is outside
        const subs = Object.fromEntries(factsOf(pack, 'subcategory').map((f) => [f.label, f.amount]));
        expect(subs).toMatchObject({ dairy: 22, produce: 12, pantry: 18 });
        expect(subs.unknown).toBe(90); // the 10 and 30 not read on two receipts plus the Esselunga receipt without items (50)
        const sum = Object.values(subs).reduce((s, v) => s + v, 0);
        expect(Math.round(sum * 100) / 100).toBe(142); // subcategories add up to the grocery lines: no double count
        expect(sum + total.otherCategoryLines).toBe(total.amount);
    });

    it('reports honest coverage and the amount without item detail', () => {
        expect(pack.coverage).toMatchObject({ total: 150, receipts: 3, receiptsWithItems: 2 });
        expect(pack.coverage.itemised).toBe(60);
        expect(pack.coverage.unknown).toBe(90);
        expect(pack.coverage.share).toBe(40);
    });

    it('explains the change against the same elapsed days of the previous period', () => {
        const rows = Object.fromEntries(factsOf(pack, 'change_row').map((f) => [f.label, f]));
        expect(rows.dairy).toMatchObject({ current: 22, previous: 6, delta: 16 });
        expect(factsOf(pack, 'change_total')[0]).toMatchObject({ current: 142, previous: 50, delta: 92, comparison: 'elapsed' });
    });

    it('supports facts with receipts and lines, and flags lines that are uncertain', () => {
        expect(pack.facts.every((f) => f.refs.every((r) => refs[r]))).toBe(true);
        const ids = Object.values(refs).map((r) => r.txId);
        expect(ids.length).toBeGreaterThan(0);
        expect(pack.evidence.some((e) => e.type === 'item' && e.name === 'Latte intero 1L')).toBe(true);
        expect(factsOf(pack, 'top_items')[0].extracted).toBe(true);
        expect(JSON.stringify(pack)).not.toMatch(/"txId"|"userId"/); // record ids stay on the device
    });

    it('full basis differs from share only for shared receipts', () => {
        const dining = (p) => buildEvidencePack({ ...base(), question: 'top merchant', intent: 'top_merchant', basis: p }).pack;
        const share = dining('share').facts.find((f) => f.kind === 'spend_total').amount;
        const full = dining('full').facts.find((f) => f.kind === 'spend_total').amount;
        expect(full - share).toBe(20); // the split dinner: 40 paid, 20 mine
        expect(buildEvidencePack({ ...base(), intent: 'general', basis: 'full' }).pack.basis).toBe('full');
    });
});

describe('top merchant', () => {
    it('ranks supermarkets by receipt totals and says which basis', () => {
        const { pack } = buildEvidencePack({ ...base(), question: 'What is my top supermarket this cycle?' });
        const m = factsOf(pack, 'merchant');
        expect(m[0]).toMatchObject({ name: 'Conad', amount: 60, count: 1, category: 'Groceries' });
        expect(m.map((x) => x.name)).toEqual(['Conad', 'Esselunga', 'Lidl']);
    });
});

describe('change vs previous comparable period', () => {
    it('compares completed with completed once the period is over', () => {
        const { pack } = buildEvidencePack({ ...base({ period: monthPeriod('2026-10'), today: '2026-11-20' }), intent: 'change' });
        expect(pack.comparison.basis).toBe('completed');
        expect(factsOf(pack, 'change_total')[0].current).toBe(60); // Oct: 30 + 20 + 10
    });
});

describe('buying more vs paying more (matching units only)', () => {
    it('compares kg with kg and litres with litres, never across families', () => {
        const cmp = comparablePeriods(NOV, TODAY, undefined);
        void cmp;
        const { pack } = buildEvidencePack({ ...base(), intent: 'unit_price' });
        const rows = Object.fromEntries(factsOf(pack, 'unit_price').map((f) => [f.name, f]));
        expect(rows['Latte intero 1L']).toMatchObject({ base: 'l', qtyNow: 10, qtyPrev: 4 });
        expect(rows['Latte intero 1L'].priceNow).toBe(2.2); // (10 + 12) / 10
        expect(rows['Latte intero 1L'].pricePrev).toBe(1.5);
        expect(rows['Latte intero 1L'].verdict).toBe('both');
        expect(rows.Mele).toMatchObject({ base: 'kg', qtyNow: 4, qtyPrev: 5, priceNow: 3, pricePrev: 2, verdict: 'paying_more' });
    });
    it('skips a product whose unit family changed', () => {
        const txs = [
            tx('Lidl', 10, 'Groceries', '2026-11-03', { lineItems: [line('x1', 'Acqua', 10, 'Groceries', 'beverages', { unit: 'l', quantity: 5 })] }),
            tx('Lidl', 10, 'Groceries', '2026-10-03', { lineItems: [line('x2', 'Acqua', 10, 'Groceries', 'beverages', { unit: 'kg', quantity: 5 })] }),
        ];
        const cmp = comparablePeriods(NOV, TODAY, (r) => ({ start: '2026-10-01', end: '2026-10-31' }));
        void cmp;
        const { pack } = buildEvidencePack({ ...base({ transactions: txs }), intent: 'unit_price' });
        expect(pack.insufficient).toBe('no_comparable_units');
    });
    it('productComparison needs both periods', () => {
        expect(productComparison([], { current: { start: '2026-11-01', end: '2026-11-20' }, previous: { start: '2026-10-01', end: '2026-10-20' } })).toEqual([]);
    });
});

describe('owed and owing', () => {
    it('comes from splits: my share vs what I paid', () => {
        const { pack } = buildEvidencePack({ ...base(), intent: 'owed' });
        expect(factsOf(pack, 'owed_total')[0]).toEqual(expect.objectContaining({ owedToMe: 20, iOwe: 0 }));
        expect(factsOf(pack, 'balance')[0]).toMatchObject({ direction: 'owes_me', amount: 20 });
    });
    it('says there is nothing when nothing is shared', () => {
        expect(buildEvidencePack({ ...base({ transactions: data().filter((t) => !t.splitData) }), intent: 'owed' }).pack.insufficient).toBe('no_shared');
    });
});

describe('records needing review', () => {
    it('finds uncategorised, unread photos, mismatched items and probable duplicates', () => {
        const txs = [
            ...data(),
            tx('Q8', 30, 'Other', '2026-11-05'),
            tx('Receipt to read', 0, 'Other', '2026-11-06', { extraction: { pending: true } }),
            tx('Coffee Shop', 4.2, 'Dining', '2026-11-07'),
            tx('Coffee Shop', 4.2, 'Dining', '2026-11-07', { createdAt: '2026-11-07T11:00:00Z' }),
        ];
        const c = reviewCandidates(txs, { period: NOV, today: TODAY });
        expect(c.uncategorised.map((t) => t.merchant)).toContain('Q8');
        expect(c.pending).toHaveLength(1);
        expect(c.mismatched.length).toBeGreaterThan(0);
        expect(c.dupes).toHaveLength(1);
        expect(c.dupes[0].remove.createdAt > c.dupes[0].keep.createdAt).toBe(true);
        const { pack } = buildEvidencePack({ ...base({ transactions: txs }), intent: 'review' });
        expect(factsOf(pack, 'review_count').map((f) => f.label)).toEqual(expect.arrayContaining(['uncategorised', 'photo_unread', 'possible_duplicates']));
    });
});

describe('insufficient data', () => {
    it('flags an empty period instead of inventing an answer', () => {
        const { pack } = buildEvidencePack({ ...base({ transactions: [] }), intent: 'grocery_breakdown' });
        expect(pack.insufficient).toBe('no_grocery_receipts');
        expect(buildEvidencePack({ ...base({ transactions: [] }), intent: 'general' }).pack.insufficient).toBe('no_spending');
    });
});

describe('conversion status travels with the pack', () => {
    it('counts foreign-currency rows without an EUR amount', () => {
        const { pack } = buildEvidencePack({ ...base({ transactions: [...data(), tx('Hotel', 100, 'Housing', '2026-11-08', { currency: 'USD', amountBase: null })] }), intent: 'general' });
        expect(pack.conversion.count).toBe(1);
        expect(pack.conversion.byCurrency.USD.total).toBe(100);
    });
});

describe('validating the model answer', () => {
    const { pack } = buildEvidencePack({ ...base(), question: 'what drove grocery spending' });
    it('keeps only citations that exist and reports grounding', () => {
        const v = validateAnswer({ answer: 'Groceries were 150.00 EUR.', citations: ['F2', 'F999', 'x'], uncertain: ['F3', 'F777'] }, pack);
        expect(v.citations).toEqual(['F2']);
        expect(v.uncertain).toEqual(['F3']);
        expect(v.grounded).toBe(true);
        expect(validateAnswer({ answer: 'Hello', citations: [] }, pack).grounded).toBe(false);
    });
    it('flags figures that are not in the facts', () => {
        expect(unsupportedFigures('Groceries were 150.00 and dairy 22.00.', pack)).toEqual([]);
        expect(unsupportedFigures('You spent 987.65 on pasta.', pack)).toEqual(['987.65']);
        expect(unsupportedFigures('That is 3 receipts in 20 days (2026).', pack)).toEqual([]);
    });
});

describe('asking with a mocked /api/chat', () => {
    it('sends only the pack (no ids) and returns a validated, grounded answer', async () => {
        const { pack } = buildEvidencePack({ ...base(), question: 'what drove grocery spending' });
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'Groceries were 150.00 EUR, 35% itemised.', citations: ['F2'], uncertain: ['F2'], proposals: [], model: 'deepseek-flash' }) });
        const out = await sendEvidenceChat({ pack, thread: [{ role: 'user', content: 'what drove grocery spending' }], getToken: async () => 'tok', fetchImpl });
        expect(out.grounded).toBe(true);
        expect(out.citations).toEqual(['F2']);
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(body.evidence.facts.length).toBe(pack.facts.length);
        expect(body.evidence.period.start).toBe('2026-11-01');
        expect(JSON.stringify(body)).not.toMatch(/userId|"u"|t1"/);
        expect(body.aggregates).toBeUndefined();
    });
});

import { inferBasis } from '../evidencePack';
describe('basis comes from the question, not a toggle', () => {
    it('spending questions use my share', () => {
        for (const q of ['What did I spend on groceries?', 'Where did grocery money go?', 'Top supermarket this cycle', 'Quanto ho speso al supermercato?']) expect(inferBasis(q)).toBe('share');
    });
    it('payment and cash-flow questions use the full amount', () => {
        for (const q of ['How much did I pay at Conad?', 'What left my account this month?', 'What was the whole bill for the Lisbon trip?', 'Quanto ho pagato da Lidl?', 'Wie viel habe ich bezahlt?']) expect(inferBasis(q)).toBe('full');
    });
});
