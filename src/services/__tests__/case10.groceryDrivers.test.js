// Brief section 12 case 10: "what drove grocery spending" -> right period, share basis, item lines, honest coverage.
// Synthetic receipts, a pay-cycle period (payday 12) and a mocked /api/chat that only sees what the boundary lets through.
import { describe, expect, it, vi } from 'vitest';
import { buildEvidencePack } from '../evidencePack';
import { sendEvidenceChat } from '../chatApi';
import { cyclePeriod, normalizeConfig } from '../../utils/payCycle';

const line = (id, name, amount, sub, extra = {}) => ({ v: 2, id, name, price: amount, amount, quantity: 1, category: 'Groceries', subcategory: sub, reviewStatus: 'confirmed', userEdited: [], ...extra });
const tx = (id, merchant, total, date, extra = {}) => ({ id, userId: 'secret-user-id', merchant, total, currency: 'EUR', category: 'Groceries', date, lineItems: [], transactionType: 'expense', createdAt: `${date}T09:00:00Z`, ...extra });
const split = { v: 2, payer: 'me', participants: [{ id: 'me', name: 'Me' }, { id: 'p1', name: 'Marta Bianchi' }], method: 'equal', shares: { me: 3000, p1: 3000 } };

const config = normalizeConfig({ timezone: 'Europe/Rome', rules: [{ from: '0000-01', payday: 12, weekendRule: 'none' }], overrides: [] });
const period = cyclePeriod('2026-10', config); // 12 Oct - 11 Nov
const transactions = [
    tx('g1', 'Lidl', 40, '2026-10-20', { lineItems: [line('l1', 'Latte intero 1L', 10, 'dairy'), line('l2', 'Mele', 12, 'produce')] }),
    tx('g2', 'Conad', 60, '2026-11-05', { splitData: split, lineItems: [line('l3', 'Pasta', 18, 'pantry'), line('l4', 'Pollo', 12, 'meat_fish', { reviewStatus: 'needs_review' })] }),
    tx('g3', 'Esselunga', 50, '2026-11-08'),
    tx('old', 'Lidl', 70, '2026-09-30', { lineItems: [line('o1', 'Latte intero 1L', 4, 'dairy')] }), // before the cycle: must not count
];
const ask = async (basis) => {
    const { pack } = buildEvidencePack({ transactions, period, config, today: '2026-11-10', intent: 'grocery_breakdown', question: 'what drove grocery spending', basis, people: [{ id: 'p1', name: 'Marta Bianchi' }] });
    let sent;
    const fetchImpl = vi.fn(async (_url, init) => {
        sent = JSON.parse(init.body);
        const cited = sent.evidence.facts.filter((f) => ['category_total', 'subcategory'].includes(f.kind)).map((f) => f.id);
        return { ok: true, status: 200, json: async () => ({ answer: `Groceries were ${sent.evidence.facts.find((f) => f.kind === 'category_total').amount.toFixed(2)} in this cycle.`, citations: cited, uncertain: [], proposals: [], model: 'mock' }) };
    });
    const out = await sendEvidenceChat({ pack, thread: [{ role: 'user', content: 'what drove grocery spending' }], getToken: async () => 't', fetchImpl });
    return { pack, sent, out };
};

describe('case 10: what drove grocery spending', () => {
    it('uses the pay cycle, not the calendar month, and leaves out receipts before it', async () => {
        const { pack, sent } = await ask('share');
        expect(sent.evidence.period).toMatchObject({ start: '2026-10-12', end: '2026-11-11', kind: 'cycle' });
        const total = sent.evidence.facts.find((f) => f.kind === 'category_total');
        expect(total.count).toBe(3);
        expect(JSON.stringify(sent)).not.toContain('"o1"');
        expect(pack.comparison.basis).toBe('elapsed');
    });

    it('share basis counts only my half of the shared receipt; full basis counts what was paid', async () => {
        const share = (await ask('share')).sent.evidence;
        const full = (await ask('full')).sent.evidence;
        expect(share.basis).toBe('share');
        expect(share.facts.find((f) => f.kind === 'category_total').amount).toBe(120); // 40 + 30 + 50
        expect(full.facts.find((f) => f.kind === 'category_total').amount).toBe(150);
    });

    it('sends the item lines that explain it, flags the unsure one, and states coverage honestly', async () => {
        const { sent } = await ask('full');
        const names = sent.evidence.evidence.filter((e) => e.type === 'item').map((e) => e.name);
        expect(names).toEqual(expect.arrayContaining(['Latte intero 1L', 'Pasta']));
        expect(sent.evidence.evidence.find((e) => e.name === 'Pollo')?.uncertain).toBe(true);
        expect(sent.evidence.coverage).toMatchObject({ total: 150, itemised: 52, unknown: 98, receipts: 3, receiptsWithItems: 2 });
        const unknown = sent.evidence.facts.find((f) => f.kind === 'subcategory' && f.label === 'unknown');
        expect(unknown.amount).toBe(98); // Esselunga has no lines (50), plus what the lines of Lidl (18) and Conad (30) do not explain
    });

    it('the answer is grounded in cited facts and quotes no figure that is not in the evidence', async () => {
        const { out } = await ask('share');
        expect(out.grounded).toBe(true);
        expect(out.citations.length).toBeGreaterThan(0);
        expect(out.unsupported).toEqual([]);
    });

    it('nothing identifying leaves the device', async () => {
        const { sent } = await ask('share');
        const text = JSON.stringify(sent);
        expect(text).not.toMatch(/secret-user-id|Marta|Bianchi|"g1"|"g2"|"p1"/);
    });
});
