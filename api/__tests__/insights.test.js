// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_lib/llm.js', async (importOriginal) => ({ ...(await importOriginal()), chat: vi.fn() }));
vi.mock('../_lib/auth.js', () => ({ requireUser: vi.fn() }));
vi.mock('../_lib/ratelimit.js', () => ({ consume: vi.fn(), recordTokens: vi.fn() }));

import handler, { narrativeSchema } from '../insights.js';
import { chat, LlmError } from '../_lib/llm.js';
import { requireUser } from '../_lib/auth.js';
import { consume } from '../_lib/ratelimit.js';
import { HttpError } from '../_lib/http.js';
import { fakeReq, fakeRes, fakeSupabase } from '../_lib/__tests__/testUtils.js';

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
const AGG = { month: '2026-11', currency: 'EUR', summary: { spent: 500, income: 2000, saved: 300 }, findings: [] };
const NARRATIVE = {
    headline: 'You saved 15% of your income so far',
    summary: 'You spent €500 and moved €300 to savings.',
    wins: ['Savings rate 15%'],
    concerns: ['Dining is €60 above average'],
    actions: ['Cap Dining at €120 for the rest of the month'],
    questions: ['Where can I cut €100?'],
};
let client;
const post = async (body) => {
    const res = fakeRes();
    await handler(fakeReq({ body }), res);
    return res;
};

beforeEach(() => {
    vi.clearAllMocks();
    client = fakeSupabase();
    requireUser.mockResolvedValue({ userId: 'u1', client });
    consume.mockResolvedValue({});
    chat.mockResolvedValue({ data: NARRATIVE, usage, model: 'deepseek-chat', durationMs: 5 });
});

describe('narrativeSchema', () => {
    it('trims, limits list sizes and accepts object items', () => {
        const out = narrativeSchema.parse({ headline: ' Hi ', summary: 's', wins: ['a', 'b', 'c', 'd', { text: 'e' }], concerns: [{ title: 'x' }, '', null], actions: 'oops', questions: ['q1', 'q2', 'q3'] });
        expect(out.headline).toBe('Hi');
        expect(out.wins).toEqual(['a', 'b', 'c']);
        expect(out.concerns).toEqual(['x']);
        expect(out.actions).toEqual([]);
        expect(out.questions).toEqual(['q1', 'q2']);
    });
    it('requires headline and summary', () => {
        expect(narrativeSchema.safeParse({ summary: 's' }).success).toBe(false);
        expect(narrativeSchema.safeParse({ headline: 'h' }).success).toBe(false);
    });
});

describe('POST /api/insights', () => {
    it('generates, returns the documented shape and writes the cache', async () => {
        const res = await post({ aggregates: AGG, language: 'it', inputHash: 'abcdef0123456789' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ ...NARRATIVE, model: 'deepseek-chat', cached: false });
        expect(typeof res.body.generatedAt).toBe('string');
        expect(Object.keys(res.body).sort()).toEqual(['actions', 'cached', 'concerns', 'generatedAt', 'headline', 'model', 'questions', 'summary', 'wins']);

        expect(consume).toHaveBeenCalledWith(client, 'u1', 'insights');
        const args = chat.mock.calls[0][0];
        expect(args.json).toBe(true);
        expect(args.messages[0].content).toContain('language: it');
        expect(args.messages[1].content).toContain('"summary"');

        expect(client.tables.insights_cache).toHaveLength(1);
        expect(client.tables.insights_cache[0]).toMatchObject({ user_id: 'u1', period: '2026-11', input_hash: 'abcdef0123456789:it', model: 'deepseek-chat' });
        expect(client.tables.insights_cache[0].payload.headline).toBe(NARRATIVE.headline);
    });

    it('serves the cache when the hash matches: no rate-limit use, no model call', async () => {
        await post({ aggregates: AGG, inputHash: 'abcdef0123456789' });
        chat.mockClear();
        consume.mockClear();
        const res = await post({ aggregates: AGG, inputHash: 'abcdef0123456789' });
        expect(res.statusCode).toBe(200);
        expect(res.body.cached).toBe(true);
        expect(res.body.headline).toBe(NARRATIVE.headline);
        expect(chat).not.toHaveBeenCalled();
        expect(consume).not.toHaveBeenCalled();
    });

    it('regenerates when the hash changes or the language differs, replacing the cache row', async () => {
        await post({ aggregates: AGG, inputHash: 'aaaaaaaa' });
        await post({ aggregates: AGG, inputHash: 'bbbbbbbb' });
        await post({ aggregates: AGG, inputHash: 'bbbbbbbb', language: 'it' });
        expect(chat).toHaveBeenCalledTimes(3);
        expect(client.tables.insights_cache).toHaveLength(1);
        expect(client.tables.insights_cache[0].input_hash).toBe('bbbbbbbb:it');
    });

    it('refresh bypasses the cache but still counts against the limit', async () => {
        await post({ aggregates: AGG, inputHash: 'aaaaaaaa' });
        chat.mockClear();
        const res = await post({ aggregates: AGG, inputHash: 'aaaaaaaa', refresh: true });
        expect(res.body.cached).toBe(false);
        expect(chat).toHaveBeenCalledTimes(1);
        expect(consume).toHaveBeenCalledTimes(2);
    });

    it('computes a hash itself when the client sends none', async () => {
        await post({ aggregates: AGG });
        await post({ aggregates: AGG });
        expect(chat).toHaveBeenCalledTimes(1);
        await post({ aggregates: { ...AGG, summary: { spent: 501 } } });
        expect(chat).toHaveBeenCalledTimes(2);
    });

    it('keeps one cache row per period', async () => {
        await post({ aggregates: AGG, inputHash: 'aaaaaaaa' });
        await post({ aggregates: { ...AGG, month: '2026-10' }, inputHash: 'aaaaaaaa' });
        expect(client.tables.insights_cache.map((r) => r.period).sort()).toEqual(['2026-10', '2026-11']);
    });

    it('does not read other users cache rows', async () => {
        client.tables.insights_cache = [{ user_id: 'other', period: '2026-11', input_hash: 'aaaaaaaa:en', payload: { ...NARRATIVE, generatedAt: 'x' }, model: 'm', created_at: 'x' }];
        const res = await post({ aggregates: AGG, inputHash: 'aaaaaaaa' });
        expect(res.body.cached).toBe(false);
    });

    it('validates input', async () => {
        expect((await post({})).statusCode).toBe(400);
        expect((await post({ aggregates: { nope: 1 } })).statusCode).toBe(400);
        expect((await post({ aggregates: { month: '2026-1' } })).statusCode).toBe(400);
        expect((await post({ aggregates: AGG, language: 'english please' })).statusCode).toBe(400);
        expect(chat).not.toHaveBeenCalled();
    });

    it('rejects oversized aggregates', async () => {
        const huge = { ...AGG, blob: 'x'.repeat(90 * 1024) };
        expect((await post({ aggregates: huge })).statusCode).toBe(413);
    });

    it('401, 429 and model failures map to statuses; nothing is cached on failure', async () => {
        requireUser.mockRejectedValueOnce(new HttpError(401, 'no'));
        expect((await post({ aggregates: AGG })).statusCode).toBe(401);
        consume.mockRejectedValueOnce(new HttpError(429, 'limit'));
        expect((await post({ aggregates: AGG })).statusCode).toBe(429);
        chat.mockRejectedValueOnce(new LlmError('x', { code: 'upstream' }));
        expect((await post({ aggregates: AGG })).statusCode).toBe(502);
        chat.mockResolvedValueOnce({ data: { headline: '', summary: '' }, usage, model: 'm', durationMs: 1 });
        expect((await post({ aggregates: AGG })).statusCode).toBe(502);
        expect(client.tables.insights_cache || []).toHaveLength(0);
    });

    it('still answers when the cache write fails', async () => {
        client.from = (name) => ({
            select: () => ({ eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }),
            upsert: async () => { throw new Error('db down'); },
        });
        const res = await post({ aggregates: AGG });
        expect(res.statusCode).toBe(200);
        expect(res.body.cached).toBe(false);
    });
});
