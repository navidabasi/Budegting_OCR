// @vitest-environment node
// Regression: the outbound privacy filter must not break the /api/insights request contract.
// On 2026-11-11 the filter erased `inputHash` (a long hex token looks like an identifier), the server rejected the body
// with a 400 and Insights showed "Couldn't write the summary".
import { describe, expect, it } from 'vitest';
import { buildInsightsRequest } from '../insightsApi';
import { hashAggregates } from '../insightsAggregates';
import { sanitizeBody } from '../aiOutbound';
import { inputSchema } from '../../../api/insights.js';

const aggregates = {
    version: 3,
    month: '2026-11',
    period: { kind: 'cycle', start: '2026-11-01', end: '2026-12-07' },
    currency: 'EUR',
    dayOfMonth: 11,
    daysInMonth: 37,
    monthState: 'current',
    summary: { spent: 769.5, income: 1432, saved: 0, savingsRate: 0, upcoming: 10, travel: 81 },
    categoriesByMonth: { '2026-10': { Groceries: 345.52 }, '2026-11': { Groceries: 6, Housing: 380 } },
    topMerchants: [{ key: 'rent', name: 'Rent', count: 1, total: 380 }],
};

describe('insights request survives the outbound filter', () => {
    it('keeps the input hash and passes the server schema after sanitising', () => {
        const body = buildInsightsRequest({ aggregates, language: 'en' });
        expect(body.inputHash).toBe(hashAggregates(aggregates));
        const sent = sanitizeBody('insights', body);
        expect(sent.inputHash).toBe(body.inputHash);
        const parsed = inputSchema.safeParse(sent);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });
    it('also passes with refresh and a regional language tag', () => {
        const sent = sanitizeBody('insights', buildInsightsRequest({ aggregates, language: 'it-IT', refresh: true }));
        expect(inputSchema.safeParse(sent).success).toBe(true);
    });
});

// Same contract check for the assistant and AI categorise: what leaves the device must pass the server's validation.
import { vi } from 'vitest';
import { buildEvidencePack } from '../evidencePack';
import { sendEvidenceChat } from '../chatApi';
import { categorizeMerchants } from '../aiCategorize';
import { cyclePeriod, normalizeConfig } from '../../utils/payCycle';
import { inputSchema as chatSchema } from '../../../api/chat.js';
import { inputSchema as categorizeSchema } from '../../../api/categorize.js';

describe('chat and categorise requests survive the outbound filter', () => {
    it('evidence chat body passes the server schema', async () => {
        const config = normalizeConfig({ timezone: 'Europe/Rome', rules: [{ from: '0000-01', payday: 12, weekendRule: 'none' }], overrides: [] });
        const period = cyclePeriod('2026-10', config);
        const transactions = [
            { id: 'g1', userId: 'u', merchant: 'Lidl 0231 Via Roma 12 Torino', total: 40, currency: 'EUR', category: 'Groceries', date: '2026-10-20', lineItems: [], transactionType: 'expense', createdAt: '2026-10-20T09:00:00Z' },
            { id: 'g2', userId: 'u', merchant: 'Conad', total: 60, currency: 'EUR', category: 'Groceries', date: '2026-11-05', lineItems: [], transactionType: 'expense', createdAt: '2026-11-05T09:00:00Z' },
        ];
        const { pack } = buildEvidencePack({ transactions, period, config, today: '2026-11-10', intent: 'grocery_breakdown', question: 'What did I spend on groceries?', basis: 'share', people: [] });
        let sent;
        const fetchImpl = vi.fn(async (_u, init) => {
            sent = JSON.parse(init.body);
            return { ok: true, status: 200, json: async () => ({ answer: 'ok', citations: [], uncertain: [], proposals: [], model: 'm' }) };
        });
        await sendEvidenceChat({ pack, thread: [{ role: 'user', content: 'What did I spend on groceries?' }], getToken: async () => 't', fetchImpl });
        const parsed = chatSchema.safeParse(sent);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });
    it('categorise body passes the server schema', async () => {
        let sent;
        const fetchImpl = vi.fn(async (_u, init) => {
            sent = JSON.parse(init.body);
            return { ok: true, status: 200, json: async () => ({ results: [], model: 'm' }) };
        });
        await categorizeMerchants({ merchants: [{ key: 'q8 torino nord', name: 'Q8 Torino Nord', sampleItems: [] }], categories: ['Fuel', 'Other'], getToken: async () => 't', fetchImpl });
        const parsed = categorizeSchema.safeParse(sent);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });
});

// ---- pass 3: insights v2 (opportunities, findings with ids, dismissed) and the new chat intents ------------------------------
import { buildAggregates, buildRefMap } from '../insightsAggregates';
import { computeOpportunities } from '../savingsOpportunities';
import { ownerLike, TODAY } from '../__fixtures__/ownerLike';
import { currentCyclePeriod } from '../../utils/payCycle';
import { finalizeNarrative, narrativeSchema, MAX_AGGREGATE_BYTES } from '../../../api/insights.js';

describe('insights v2 request survives the outbound filter (owner-like data)', () => {
    const d = ownerLike();
    const period = currentCyclePeriod(normalizeConfig(d.config), new Date(`${TODAY}T12:00:00Z`));
    const opp = computeOpportunities({ ...d, period, dismissed: { 'subscription_review:spotify': '2026-11-01' } });
    const aggregates = buildAggregates({ ...d, month: period, opportunities: opp.top, dismissed: opp.dismissed });
    const body = buildInsightsRequest({ aggregates, language: 'it' });
    const sent = sanitizeBody('insights', body);

    it('passes the server schema and stays inside the size limit', () => {
        const parsed = inputSchema.safeParse(sent);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        expect(JSON.stringify(sent.aggregates).length).toBeLessThan(MAX_AGGREGATE_BYTES);
        expect(sent.inputHash).toBe(body.inputHash);
    });
    it('every opportunity arrives intact: ids, kinds, names, figures and dates', () => {
        expect(opp.top.length).toBeGreaterThanOrEqual(4);
        expect(sent.aggregates.opportunities).toEqual(aggregates.opportunities);
        expect(sent.aggregates.opportunities.map((o) => o.id)).toEqual(opp.top.map((_, i) => `O${i + 1}`));
        expect(sent.aggregates.opportunities.map((o) => o.oppKind)).toEqual(opp.top.map((o) => o.kind));
        expect(sent.aggregates.dismissed).toEqual([{ oppKind: 'subscription_review', category: 'Subscriptions', merchant: 'Spotify' }]);
        expect(sent.aggregates.verdict).toEqual(aggregates.verdict);
        expect(sent.aggregates.findings.map((f) => [f.id, f.type, f.figures])).toEqual(aggregates.findings.map((f) => [f.id, f.type, f.figures]));
    });
    it('no record id, note or account name leaves the device', () => {
        const text = JSON.stringify(sent);
        for (const t of d.transactions) expect(text.includes(`"${t.id}"`)).toBe(false);
        expect(text).not.toMatch(/"(notes|txId|evidence|accountId|userId|goalId)"/);
        expect(text).not.toContain('synthetic-user');
    });
    it('every kind of opportunity keeps its figures through the filter', () => {
        const all = computeOpportunities({ ...d, period, limit: 50 });
        const kinds = new Set(all.all.map((o) => o.kind));
        for (const k of ['category_above_baseline', 'merchant_frequency', 'subscription_review', 'price_creep', 'cheaper_store', 'budget_gap', 'debt_cost', 'goal_boost', 'uncategorised_blind_spot', 'fixed_cost']) expect(kinds.has(k), k).toBe(true);
        // send them in batches of 8 (the server's limit) and compare with what was built
        for (let i = 0; i < all.all.length; i += 8) {
            const batch = all.all.slice(i, i + 8);
            const agg = buildAggregates({ ...d, month: period, opportunities: batch });
            const out = sanitizeBody('insights', buildInsightsRequest({ aggregates: agg, language: 'en' }));
            expect(inputSchema.safeParse(out).success).toBe(true);
            expect(out.aggregates.opportunities).toEqual(agg.opportunities);
        }
    });
    it('the answer is checked against exactly what was sent: unknown ids and invented numbers are removed', () => {
        const top = sent.aggregates.opportunities[0];
        const raw = {
            verdict: `Dining is ${top.excess} above your usual ${top.baseline} so far.`,
            opportunities: [
                { id: 'O1', explanation: `Dining is at ${top.current} against a usual ${top.baseline}.`, howTo: `A budget of ${top.suggestedBudget} would hold it.` },
                { id: 'O2', explanation: 'Putting 9999 aside would finish the goal next month.' },
                { id: 'O42', explanation: 'Cancel your gym membership.' },
            ],
            wins: [{ text: 'Groceries stayed inside the budget.', ref: 'N1' }, { text: 'Nice.', ref: 'N99' }],
        };
        const { payload, dropped } = finalizeNarrative(narrativeSchema.parse(raw), sent.aggregates);
        expect(payload.verdict).toBe(raw.verdict);
        expect(payload.opportunities.map((o) => o.id)).toEqual(['O1']);
        expect(payload.wins).toEqual([{ text: 'Groceries stayed inside the budget.', ref: 'N1' }, { text: 'Nice.', ref: null }]);
        expect(dropped.map((x) => x.reason).sort()).toEqual(['number_not_in_input', 'unknown_id']);
        // ...and the ids map back to the cards on the device
        const map = buildRefMap([], opp.top);
        expect(map[payload.opportunities[0].id]).toBe(opp.top[0].key);
    });
});

describe('new chat intents survive the outbound filter (owner-like data)', () => {
    const d = ownerLike();
    const period = currentCyclePeriod(normalizeConfig(d.config), new Date(`${TODAY}T12:00:00Z`));
    const send = async (question) => {
        const { pack } = buildEvidencePack({ ...d, period, question });
        let sent;
        const fetchImpl = vi.fn(async (_u, init) => {
            sent = JSON.parse(init.body);
            return { ok: true, status: 200, json: async () => ({ answer: 'ok', citations: [], uncertain: [], proposals: [], model: 'm' }) };
        });
        await sendEvidenceChat({ pack, thread: [{ role: 'user', content: question }], getToken: async () => 't', fetchImpl });
        return { pack, sent };
    };
    it.each([
        ['save_money', 'Where can I cut this period?'],
        ['afford', 'Can I afford 200?'],
        ['history', 'What do I spend on groceries per cycle on average?'],
    ])('%s passes the server schema with its facts intact', async (intent, question) => {
        const { pack, sent } = await send(question);
        expect(pack.intent).toBe(intent);
        expect(pack.insufficient).toBeNull();
        const parsed = chatSchema.safeParse(sent);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        expect(sent.evidence.intent).toBe(intent);
        // facts arrive as built: kinds, figures, opportunity kinds and dates
        expect(sent.evidence.facts.map((f) => f.id)).toEqual(pack.facts.map((f) => f.id));
        expect(sent.evidence.facts.map((f) => [f.kind, f.oppKind, f.monthlySaving, f.amount, f.verdict, f.periodStart])).toEqual(pack.facts.map((f) => [f.kind, f.oppKind, f.monthlySaving, f.amount, f.verdict, f.periodStart]));
        const text = JSON.stringify(sent);
        for (const t of d.transactions) expect(text.includes(`"${t.id}"`)).toBe(false);
    });
});
