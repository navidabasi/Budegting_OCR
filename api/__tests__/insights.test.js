// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_lib/llm.js', async (importOriginal) => ({ ...(await importOriginal()), chat: vi.fn() }));
vi.mock('../_lib/auth.js', () => ({ requireUser: vi.fn() }));
vi.mock('../_lib/ratelimit.js', () => ({ consume: vi.fn(), recordTokens: vi.fn() }));

import handler, { finalizeNarrative, inputSchema, narrativeSchema, MAX_TOKENS } from '../insights.js';
import { chat, LlmError } from '../_lib/llm.js';
import { requireUser } from '../_lib/auth.js';
import { consume } from '../_lib/ratelimit.js';
import { HttpError } from '../_lib/http.js';
import { fakeReq, fakeRes, fakeSupabase } from '../_lib/__tests__/testUtils.js';

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
const AGG = {
    month: '2026-11',
    currency: 'EUR',
    summary: { spent: 500, income: 2000, saved: 300 },
    verdict: { spent: 500, spentBefore: 440, change: 60, saved: 300, safePerDay: 21.5 },
    findings: [{ id: 'N1', type: 'streak', severity: 'positive', title: 'Groceries: under budget 3 periods in a row', figures: { count: 3, budget: 260 } }],
    opportunities: [
        { id: 'O1', oppKind: 'category_above_baseline', category: 'Dining', monthlySaving: 79, yearlySaving: 948, current: 100.5, baseline: 21.5, excess: 79 },
        { id: 'O2', oppKind: 'price_creep', merchant: 'Netflix', monthlySaving: 3, yearlySaving: 36, from: 12.99, to: 15.99, increase: 3 },
    ],
    dismissed: [{ oppKind: 'subscription_review', category: 'Subscriptions', merchant: 'Spotify' }],
};
const NARRATIVE = {
    verdict: 'You spent €500 so far, €60 more than at this point last period.',
    summary: 'Dining took €100.50 against your usual €21.50.',
    opportunities: [
        { id: 'O1', explanation: 'Dining is €79 above your usual €21.50 so far.', howTo: 'Set a Dining budget and check it weekly.' },
        { id: 'O2', explanation: 'Netflix went from €12.99 to €15.99 a month.', howTo: 'That is €36 more a year: check if a cheaper plan fits.' },
    ],
    wins: [{ text: 'Groceries stayed under the €260 budget again.', ref: 'N1' }],
    watchouts: [{ text: 'Dining is running ahead of your usual pace.', ref: 'O1' }],
    questions: ['Where can I cut €79?'],
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
    it('trims, limits list sizes, accepts strings or objects and reads the v1 names', () => {
        const out = narrativeSchema.parse({ headline: ' Hi ', summary: 's', wins: ['a', 'b', 'c', 'd', { text: 'e' }], concerns: [{ title: 'x', ref: 'N2' }, '', null], opportunities: 'oops', questions: ['q1', 'q2', 'q3', 'q4'] });
        expect(out.verdict).toBe('Hi');
        expect(out.wins).toEqual([{ text: 'a', ref: null }, { text: 'b', ref: null }, { text: 'c', ref: null }]);
        expect(out.watchouts).toEqual([{ text: 'x', ref: 'N2' }]);
        expect(out.opportunities).toEqual([]);
        expect(out.questions).toEqual(['q1', 'q2', 'q3']);
    });
    it('malformed opportunity entries are skipped, a malformed ref is cleared', () => {
        const out = narrativeSchema.parse({ verdict: 'v', opportunities: [{ id: 'O1', explanation: ' ok ' }, { id: 'O2' }, 'x', { explanation: 'no id' }], wins: [{ text: 'w', ref: 'drop table' }] });
        expect(out.opportunities).toEqual([{ id: 'O1', explanation: 'ok', howTo: undefined }]);
        expect(out.wins).toEqual([{ text: 'w', ref: null }]);
    });
});

describe('finalizeNarrative: the server checks the model against its input', () => {
    const run = (raw) => finalizeNarrative(narrativeSchema.parse(raw), AGG);
    it('keeps an answer whose ids and numbers all come from the input', () => {
        const { payload, dropped } = run(NARRATIVE);
        expect(dropped).toEqual([]);
        expect(payload).toEqual(NARRATIVE);
    });
    it('drops opportunity ids that were not sent and duplicates', () => {
        const { payload, dropped } = run({ ...NARRATIVE, opportunities: [...NARRATIVE.opportunities, { id: 'O9', explanation: 'Cancel your gym.' }, { id: 'O1', explanation: 'Again.' }] });
        expect(payload.opportunities.map((o) => o.id)).toEqual(['O1', 'O2']);
        expect(dropped).toEqual([{ where: 'opportunities.O9', reason: 'unknown_id' }, { where: 'opportunities.O1', reason: 'duplicate_id' }]);
    });
    it('drops an explanation with an invented number, and only the how-to when just that one invents', () => {
        const { payload, dropped } = run({
            ...NARRATIVE,
            opportunities: [
                { id: 'O1', explanation: 'Dining is €85 above your usual.', howTo: 'fine' },
                { id: 'O2', explanation: 'Netflix went from €12.99 to €15.99 a month.', howTo: 'Switching plans saves €48 a year.' },
            ],
        });
        expect(payload.opportunities).toEqual([{ id: 'O2', explanation: 'Netflix went from €12.99 to €15.99 a month.', howTo: null }]);
        expect(dropped).toEqual([
            { where: 'opportunities.O1.explanation', reason: 'number_not_in_input', figures: ['85'] },
            { where: 'opportunities.O2.howTo', reason: 'number_not_in_input', figures: ['48'] },
        ]);
    });
    it('drops a verdict, summary, win, watch-out or question with an invented number; clears unknown refs', () => {
        const { payload } = run({
            verdict: 'You saved 37% of your income.',
            summary: 'Dining took €100.50.',
            wins: [{ text: 'You saved €300.', ref: 'N7' }, { text: 'You cut €1,200 a year.', ref: 'N1' }],
            watchouts: [{ text: 'Dining is €79 above usual.', ref: 'O2' }, { text: 'Rent rose by €45.' }],
            questions: ['How do I save €500 a month?', 'Where did Dining go?'],
        });
        expect(payload.verdict).toBeNull();
        expect(payload.summary).toBe('Dining took €100.50.');
        expect(payload.wins).toEqual([{ text: 'You saved €300.', ref: null }]);
        expect(payload.watchouts).toEqual([{ text: 'Dining is €79 above usual.', ref: 'O2' }]);
        expect(payload.questions).toEqual(['How do I save €500 a month?', 'Where did Dining go?']); // 500 is the spent figure
    });
    it('rounded amounts, other notations and small counts are fine', () => {
        const { dropped } = run({ verdict: 'Dining: €101 so far against €22, 3 periods in a row under €260; 12,99 → 15,99.' });
        expect(dropped).toEqual([]);
    });
});

describe('POST /api/insights', () => {
    it('generates, returns the documented shape and writes the cache', async () => {
        const res = await post({ aggregates: AGG, language: 'it', inputHash: 'abcdef0123456789' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ ...NARRATIVE, v: 2, headline: NARRATIVE.verdict, model: 'deepseek-chat', cached: false });
        expect(typeof res.body.generatedAt).toBe('string');
        expect(Object.keys(res.body).sort()).toEqual(['cached', 'generatedAt', 'headline', 'model', 'opportunities', 'questions', 'summary', 'v', 'verdict', 'watchouts', 'wins']);

        expect(consume).toHaveBeenCalledWith(client, 'u1', 'insights');
        const args = chat.mock.calls[0][0];
        expect(args.json).toBe(true);
        expect(args.maxTokens).toBe(MAX_TOKENS);
        expect(MAX_TOKENS).toBeGreaterThanOrEqual(2000);
        expect(args.messages[1].content).toContain('"opportunities"');
        expect(args.messages[0].content).toContain('language: it');
        expect(args.messages[1].content).toContain('"summary"');

        expect(client.tables.insights_cache).toHaveLength(1);
        expect(client.tables.insights_cache[0]).toMatchObject({ user_id: 'u1', period: '2026-11', input_hash: 'abcdef0123456789:it', model: 'deepseek-chat' });
        expect(client.tables.insights_cache[0].payload).toMatchObject({ v: 2, verdict: NARRATIVE.verdict });
    });

    it('serves the cache when the hash matches: no rate-limit use, no model call', async () => {
        await post({ aggregates: AGG, inputHash: 'abcdef0123456789' });
        chat.mockClear();
        consume.mockClear();
        const res = await post({ aggregates: AGG, inputHash: 'abcdef0123456789' });
        expect(res.statusCode).toBe(200);
        expect(res.body.cached).toBe(true);
        expect(res.body.verdict).toBe(NARRATIVE.verdict);
        expect(res.body.opportunities).toEqual(NARRATIVE.opportunities);
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
        client.tables.insights_cache = [{ user_id: 'other', period: '2026-11', input_hash: 'aaaaaaaa:en', payload: { v: 2, ...NARRATIVE, generatedAt: 'x' }, model: 'm', created_at: 'x' }];
        const res = await post({ aggregates: AGG, inputHash: 'aaaaaaaa' });
        expect(res.body.cached).toBe(false);
    });

    it('what the model invents never reaches the client or the cache', async () => {
        chat.mockResolvedValueOnce({ data: { ...NARRATIVE, opportunities: [{ id: 'O1', explanation: 'Dining is €79 above your usual.' }, { id: 'O7', explanation: 'Cancel the gym to save €40.' }, { id: 'O2', explanation: 'Netflix costs €240 a year.' }] }, usage, model: 'm', durationMs: 1 });
        const res = await post({ aggregates: AGG, inputHash: 'cccccccc' });
        expect(res.statusCode).toBe(200);
        expect(res.body.opportunities).toEqual([{ id: 'O1', explanation: 'Dining is €79 above your usual.', howTo: null }]);
        expect(JSON.stringify(client.tables.insights_cache[0].payload)).not.toContain('gym');
        expect(JSON.stringify(client.tables.insights_cache[0].payload)).not.toContain('240');
    });

    it('a summary cached before v2 is not served as current', async () => {
        client.tables.insights_cache = [{ user_id: 'u1', period: '2026-11', input_hash: 'aaaaaaaa:en', payload: { headline: 'old', summary: 'old', generatedAt: 'x' }, model: 'm', created_at: 'x' }];
        const res = await post({ aggregates: AGG, inputHash: 'aaaaaaaa' });
        expect(res.body.cached).toBe(false);
        expect(res.body.verdict).toBe(NARRATIVE.verdict);
    });

    it('accepts aggregates from before v2 and rejects malformed v2 fields', () => {
        expect(inputSchema.safeParse({ aggregates: { month: '2026-11' } }).success).toBe(true);
        expect(inputSchema.safeParse({ aggregates: AGG }).success).toBe(true);
        expect(inputSchema.safeParse({ aggregates: { ...AGG, opportunities: [{ id: 'drop table', oppKind: 'x' }] } }).success).toBe(false);
        expect(inputSchema.safeParse({ aggregates: { ...AGG, opportunities: Array.from({ length: 9 }, (_, i) => ({ id: `O${i + 1}`, oppKind: 'x' })) } }).success).toBe(false);
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
        // everything it said was invented: nothing usable is left
        chat.mockResolvedValueOnce({ data: { verdict: 'You saved €9,999.', opportunities: [{ id: 'O4', explanation: 'x' }] }, usage, model: 'm', durationMs: 1 });
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
