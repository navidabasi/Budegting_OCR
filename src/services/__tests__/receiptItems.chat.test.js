// "What did I buy on my last grocery shopping" (owner report 2026-11-12): the answer listed 5 of 22 lines, mixed lines of two
// receipts, follow-ups lost the receipt, and the receipt total was flagged as a figure "not found in the evidence".
import { describe, expect, it } from 'vitest';
import { buildEvidencePack, focusOf, packNumbers, resolveRoute, routeQuestion, unsupportedFigures } from '../evidencePack';
import { answerBlocks } from '../../components/insights/AnswerText';

const NAMES = ['Banane bio', 'Patate 1,5kg', 'Riso basmati', 'Acqua frizzante', 'Yogurt greco 0%', 'Mozzarella', 'Pasta fusilli', 'Passata', 'Olio EVO', 'Farina 00', 'Batterie AA', 'Tonno naturale MSC', 'Le Emiliane lasagne', 'Kinder Delice T10', 'Ceci', 'Pizza margherita rettangolare', 'Frollini cacao nocciola', 'Peperoni', 'Zucchine', 'Macinato di bovino', 'Uova', 'Pane'];
const big = {
    id: 'lidl-12',
    date: '2026-11-12',
    createdAt: '2026-11-12T18:00:00Z',
    merchant: 'Lidl',
    total: 50.12,
    category: 'Groceries',
    transactionType: 'expense',
    lineItems: NAMES.map((name, i) => ({ id: `i${i}`, name, amount: i === 19 ? 11.98 : 1.85, category: name === 'Batterie AA' ? 'Shopping' : 'Groceries' })),
};
const small = { id: 'lidl-11', date: '2026-11-11', merchant: 'Lidl', total: 17.88, category: 'Groceries', transactionType: 'expense', lineItems: [{ id: 'x1', name: 'Riso basmati', amount: 4.49 }, { id: 'x2', name: 'Banane bio', amount: 13.39 }] };
const kabul = { id: 'kabul', date: '2026-11-11', merchant: 'Kabul Shop', total: 22, category: 'Groceries', transactionType: 'expense', lineItems: [] };
const transactions = [small, kabul, big];
const base = { transactions, period: '2026-11', today: '2026-11-12', currency: 'EUR', categoryNames: ['Groceries', 'Shopping'] };

describe('routing receipt questions', () => {
    it.each([
        ['What i bought on my last grocery shopping'],
        ['What did I buy at Lidl?'],
        ['List all the items on my receipt'],
        ['Tell me items in english'],
        ['cosa ho comprato ieri'],
        ['Was habe ich gekauft?'],
        ['¿Qué compré en Lidl?'],
        ["Qu'ai-je acheté ?"],
    ])('%s -> receipt_items', (q) => expect(routeQuestion(q)).toBe('receipt_items'));

    it('leaves the period questions where they were', () => {
        expect(routeQuestion('What did I spend on groceries?')).toBe('grocery_breakdown');
        expect(routeQuestion('What drove my grocery spending?')).toBe('grocery_breakdown');
        expect(routeQuestion('Which items need review?')).toBe('review');
        expect(routeQuestion('Where can I cut?')).toBe('save_money');
    });

    it('a follow-up keeps the receipt of the previous answer', () => {
        const prev = { intent: 'receipt_items', focusTxId: 'lidl-12' };
        expect(resolveRoute('There are 22 items in there you didnt report them all', prev)).toEqual({ route: 'receipt_items', focusTxId: 'lidl-12' });
        expect(resolveRoute('Tell me items in english', prev)).toEqual({ route: 'receipt_items', focusTxId: 'lidl-12' });
        expect(resolveRoute('translate them', { intent: 'grocery_breakdown' }).route).toBe('grocery_breakdown');
        // a new topic is not a follow-up
        expect(resolveRoute('Where can I cut?', prev).route).toBe('save_money');
        expect(resolveRoute('How am I doing this month?', prev).route).toBe('general');
    });
});

describe('receipt_items pack', () => {
    it('sends every line of the latest receipt of the kind asked, and only that receipt', () => {
        const { pack, refs } = buildEvidencePack({ ...base, question: 'What i bought on my last grocery shopping' });
        expect(pack.intent).toBe('receipt_items');
        const receipt = pack.facts.find((f) => f.kind === 'receipt');
        const lines = pack.facts.find((f) => f.kind === 'receipt_items');
        expect(receipt).toMatchObject({ merchant: 'Lidl', date: '2026-11-12', total: 50.12, itemCount: 22 });
        expect(lines.items).toHaveLength(22);
        expect(lines.items.map((i) => i.name)).toEqual(NAMES);
        expect(lines.items.find((i) => i.name === 'Batterie AA').category).toBe('Shopping');
        expect(refs[receipt.refs[0]].txId).toBe('lidl-12');
        // no period totals beside a single receipt
        expect(pack.facts.some((f) => f.kind === 'period_summary')).toBe(false);
        expect(pack.basis).toBe('full');
    });

    it('reports when lines and total disagree', () => {
        const { pack } = buildEvidencePack({ ...base, question: 'What did I buy at Lidl?' });
        const receipt = pack.facts.find((f) => f.kind === 'receipt');
        expect(receipt.itemsSum).toBe(50.83);
        expect(receipt.difference).toBe(-0.71);
    });

    it('names a newer receipt without lines instead of silently skipping it', () => {
        const txs = [big, { ...kabul, date: '2026-11-12', createdAt: '2026-11-12T20:00:00Z' }];
        const { pack } = buildEvidencePack({ ...base, transactions: txs, question: 'What did I buy on my last grocery shopping?' });
        expect(pack.facts.find((f) => f.kind === 'newer_without_items').receipts[0]).toMatchObject({ merchant: 'Kabul Shop', amount: 22 });
        expect(pack.facts.find((f) => f.kind === 'receipt').merchant).toBe('Lidl');
    });

    it('keeps the receipt of the previous answer on a follow-up, unless the question names another', () => {
        const first = buildEvidencePack({ ...base, question: 'What i bought on my last grocery shopping' });
        const focus = focusOf({ pack: first.pack, refs: first.refs });
        expect(focus).toBe('lidl-12');
        const next = buildEvidencePack({ ...base, intent: 'receipt_items', question: 'There are 22 items in there you didnt report them all', focusTxId: focus });
        expect(next.pack.facts.find((f) => f.kind === 'receipt_items').items).toHaveLength(22);
        const other = buildEvidencePack({ ...base, intent: 'receipt_items', question: 'and yesterday?', focusTxId: focus });
        expect(other.pack.facts.find((f) => f.kind === 'receipt').date).toBe('2026-11-11');
    });

    it('says plainly when the matching receipts have no lines', () => {
        const { pack } = buildEvidencePack({ ...base, question: 'What did I buy at Kabul Shop?' });
        expect(pack.insufficient).toBe('no_receipt_items');
    });
});

describe('figure check', () => {
    it('accepts receipt totals from the evidence and figures inside item names', () => {
        const { pack } = buildEvidencePack({ ...base, question: 'What i bought on my last grocery shopping' });
        expect(packNumbers(pack).has(50.12)).toBe(true);
        expect(unsupportedFigures('Your Lidl receipt of 50.12 EUR: potatoes 1.5 kg 1.85, minced beef 11.98.', pack)).toEqual([]);
        expect(unsupportedFigures('Minced beef 12.40', pack)).toEqual(['12.40']);
    });
});

describe('answer text', () => {
    it('turns bullet and numbered lines into lists, keeps other lines as paragraphs', () => {
        expect(answerBlocks('Your Lidl receipt:\n- Bananas: 1.85\n- Rice: 1.85\n\nAll lines are read from the receipt.')).toEqual([
            { type: 'p', lines: ['Your Lidl receipt:'] },
            { type: 'ul', lines: ['Bananas: 1.85', 'Rice: 1.85'] },
            { type: 'gap', lines: [] },
            { type: 'p', lines: ['All lines are read from the receipt.'] },
        ]);
        expect(answerBlocks('1. Open Plan\n2. Tap Add').map((b) => b.type)).toEqual(['ol']);
    });
});
