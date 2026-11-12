import { describe, it, expect, vi } from 'vitest';
import { buildInsightsRequest, fetchNarrative } from '../insightsApi';
import { hashAggregates } from '../insightsAggregates';

const aggregates = { month: '2026-11', currency: 'EUR', dayOfMonth: 10, summary: { spent: 100 }, budgets: [], goals: [], findings: [{ type: 'x' }] };
const ok = (body, status = 200) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
const getToken = async () => 'tok';

describe('insights request', () => {
    it('builds the body the endpoint expects', () => {
        const body = buildInsightsRequest({ aggregates, language: 'it' });
        expect(body).toEqual({ aggregates, language: 'it', inputHash: hashAggregates(aggregates) });
        expect(body.inputHash).toMatch(/^[0-9a-f]{8,64}$/);
        expect(buildInsightsRequest({ aggregates, language: 'it', refresh: true }).refresh).toBe(true);
    });
    it('the hash ignores the clock: day of month, verdict figures and the day-to-day numbers of findings and suggestions', () => {
        const base = { ...aggregates, findings: [{ id: 'N1', type: 'category_up', category: 'Dining', amount: 40 }], opportunities: [{ id: 'O1', oppKind: 'category_above_baseline', category: 'Dining', monthlySaving: 40 }], verdict: { daysLeft: 12 } };
        const later = { ...base, dayOfMonth: 11, findings: [{ ...base.findings[0], amount: 38 }], opportunities: [{ ...base.opportunities[0], monthlySaving: 38 }], verdict: { daysLeft: 11 } };
        expect(hashAggregates(later)).toBe(hashAggregates(base));
        // a new finding or suggestion, a dismissed one, or new data does change it
        expect(hashAggregates({ ...base, findings: [] })).not.toBe(hashAggregates(base));
        expect(hashAggregates({ ...base, opportunities: [] })).not.toBe(hashAggregates(base));
        expect(hashAggregates({ ...base, dismissed: [{ oppKind: 'budget_gap', category: 'Shopping' }] })).not.toBe(hashAggregates(base));
        expect(hashAggregates({ ...base, summary: { spent: 101 } })).not.toBe(hashAggregates(base));
    });
    it('reads a v2 answer and a summary saved before v2 into one shape', async () => {
        const { normalizeNarrative } = await import('../insightsApi');
        expect(normalizeNarrative({ headline: 'h', summary: 's', wins: ['w'], concerns: ['c'], actions: ['a'] })).toMatchObject({ v: 1, verdict: 'h', wins: [{ text: 'w', ref: null }], watchouts: [{ text: 'c', ref: null }], opportunities: [], questions: [] });
        expect(normalizeNarrative({ v: 2, verdict: 'v', opportunities: [{ id: 'O1', explanation: 'e', howTo: null }, { id: 'O2' }], watchouts: [{ text: 't', ref: 'O1' }] })).toMatchObject({ v: 2, verdict: 'v', opportunities: [{ id: 'O1', explanation: 'e' }], watchouts: [{ text: 't', ref: 'O1' }] });
    });
    it('posts with the bearer token', async () => {
        const fetchImpl = ok({ headline: 'h', summary: 's', wins: [], concerns: [], actions: [], questions: [], model: 'm', generatedAt: 'now', cached: false });
        const out = await fetchNarrative({ aggregates, language: 'en', getToken, fetchImpl });
        expect(out.verdict).toBe('h');
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('/api/insights');
        expect(init.headers.Authorization).toBe('Bearer tok');
        expect(JSON.parse(init.body).aggregates.month).toBe('2026-11');
    });
    it('maps failures to AiError kinds', async () => {
        await expect(fetchNarrative({ aggregates, getToken, fetchImpl: ok({ code: 'llm_not_configured' }, 503) })).rejects.toMatchObject({ kind: 'notConfigured' });
        await expect(fetchNarrative({ aggregates, getToken, fetchImpl: ok({}, 429) })).rejects.toMatchObject({ kind: 'rateLimit' });
        await expect(fetchNarrative({ aggregates, getToken, fetchImpl: ok({}, 500) })).rejects.toMatchObject({ kind: 'server' });
        await expect(fetchNarrative({ aggregates, getToken: async () => null, fetchImpl: ok({}) })).rejects.toMatchObject({ kind: 'auth' });
        await expect(fetchNarrative({ aggregates, getToken, fetchImpl: vi.fn().mockRejectedValue(new Error('x')) })).rejects.toMatchObject({ kind: 'network' });
    });
});
