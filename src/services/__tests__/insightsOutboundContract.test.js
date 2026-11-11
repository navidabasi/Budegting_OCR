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
