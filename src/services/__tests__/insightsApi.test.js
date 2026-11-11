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
    it('the hash ignores the day of month and findings', () => {
        expect(hashAggregates({ ...aggregates, dayOfMonth: 11, findings: [] })).toBe(hashAggregates(aggregates));
    });
    it('posts with the bearer token', async () => {
        const fetchImpl = ok({ headline: 'h', summary: 's', wins: [], concerns: [], actions: [], questions: [], model: 'm', generatedAt: 'now', cached: false });
        const out = await fetchNarrative({ aggregates, language: 'en', getToken, fetchImpl });
        expect(out.headline).toBe('h');
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
