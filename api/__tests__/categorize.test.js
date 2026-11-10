// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_lib/llm.js', async (importOriginal) => ({ ...(await importOriginal()), chat: vi.fn() }));
vi.mock('../_lib/auth.js', () => ({ requireUser: vi.fn() }));
vi.mock('../_lib/ratelimit.js', () => ({ consume: vi.fn(), recordTokens: vi.fn() }));

import handler, { sanitizeResults } from '../categorize.js';
import { chat } from '../_lib/llm.js';
import { requireUser } from '../_lib/auth.js';
import { consume } from '../_lib/ratelimit.js';
import { HttpError } from '../_lib/http.js';
import { fakeReq, fakeRes } from '../_lib/__tests__/testUtils.js';

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
const post = async (body) => {
    const res = fakeRes();
    await handler(fakeReq({ body }), res);
    return res;
};

beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ userId: 'u1', client: {} });
    consume.mockResolvedValue({});
});

describe('sanitizeResults', () => {
    const cats = ['Groceries', 'Dining', 'Other'];
    const merchants = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];

    it('keeps order, canonicalises case, clamps confidence', () => {
        const out = sanitizeResults({ results: [{ key: 'b', category: 'dining', confidence: 3 }, { key: 'a', category: 'Groceries', confidence: 0.834 }, { key: 'c', category: 'Dining', confidence: -1 }] }, merchants, cats);
        expect(out).toEqual([
            { key: 'a', category: 'Groceries', confidence: 0.83 },
            { key: 'b', category: 'Dining', confidence: 1 },
            { key: 'c', category: 'Dining', confidence: 0 },
        ]);
    });

    it('replaces categories outside the list and missing keys with Other / 0', () => {
        const out = sanitizeResults({ results: [{ key: 'a', category: 'Travel', confidence: 0.9 }, { key: 'zzz', category: 'Dining', confidence: 1 }] }, merchants, cats);
        expect(out).toEqual([
            { key: 'a', category: 'Other', confidence: 0 },
            { key: 'b', category: 'Other', confidence: 0 },
            { key: 'c', category: 'Other', confidence: 0 },
        ]);
    });

    it('accepts a bare array and survives garbage', () => {
        expect(sanitizeResults([{ key: 'a', category: 'Groceries', confidence: 0.9 }], [{ key: 'a' }], cats)[0].category).toBe('Groceries');
        expect(sanitizeResults('x', [{ key: 'a' }], cats)).toEqual([{ key: 'a', category: 'Other', confidence: 0 }]);
    });
});

describe('POST /api/categorize', () => {
    it('returns validated results from the (mocked) model', async () => {
        chat.mockResolvedValue({ data: { results: [{ key: 'lidl', category: 'Groceries', confidence: 0.95 }, { key: 'foo', category: 'Spaceship', confidence: 0.9 }] }, usage, model: 'deepseek-chat', durationMs: 1 });
        const res = await post({ merchants: [{ key: 'lidl', name: 'Lidl', sampleItems: ['Latte'] }, { key: 'foo', description: 'POS FOO' }] });
        expect(res.statusCode).toBe(200);
        expect(res.body.results).toEqual([
            { key: 'lidl', category: 'Groceries', confidence: 0.95 },
            { key: 'foo', category: 'Other', confidence: 0 },
        ]);
        const args = chat.mock.calls[0][0];
        expect(args.json).toBe(true);
        expect(args.messages[0].content).toContain('Groceries, Dining, Fuel');
        expect(args.messages[1].content).toContain('"key":"lidl"');
        expect(consume).toHaveBeenCalledWith({}, 'u1', 'categorize');
    });

    it('restricts to the provided category list', async () => {
        chat.mockResolvedValue({ data: { results: [{ key: 'x', category: 'Fuel', confidence: 0.9 }] }, usage, model: 'm', durationMs: 1 });
        const res = await post({ merchants: [{ key: 'x' }], categories: ['Groceries', 'Other'] });
        expect(res.body.results[0]).toEqual({ key: 'x', category: 'Other', confidence: 0 });
        expect(chat.mock.calls[0][0].messages[0].content).toContain('Groceries, Other');
    });

    it('de-duplicates keys', async () => {
        chat.mockResolvedValue({ data: { results: [] }, usage, model: 'm', durationMs: 1 });
        const res = await post({ merchants: [{ key: 'a' }, { key: 'a' }] });
        expect(res.body.results).toHaveLength(1);
    });

    it('rejects more than 50 merchants, empty lists and bad shapes', async () => {
        const many = Array.from({ length: 51 }, (_, i) => ({ key: `m${i}` }));
        expect((await post({ merchants: many })).statusCode).toBe(400);
        expect((await post({ merchants: [] })).statusCode).toBe(400);
        expect((await post({})).statusCode).toBe(400);
        expect(chat).not.toHaveBeenCalled();
        expect(consume).not.toHaveBeenCalled();
    });

    it('accepts exactly 50', async () => {
        const fifty = Array.from({ length: 50 }, (_, i) => ({ key: `m${i}` }));
        chat.mockResolvedValue({ data: { results: [] }, usage, model: 'm', durationMs: 1 });
        const res = await post({ merchants: fifty });
        expect(res.statusCode).toBe(200);
        expect(res.body.results).toHaveLength(50);
    });

    it('401 and 429 propagate', async () => {
        requireUser.mockRejectedValueOnce(new HttpError(401, 'no'));
        expect((await post({ merchants: [{ key: 'a' }] })).statusCode).toBe(401);
        consume.mockRejectedValueOnce(new HttpError(429, 'limit'));
        expect((await post({ merchants: [{ key: 'a' }] })).statusCode).toBe(429);
        expect(chat).not.toHaveBeenCalled();
    });

    it('maps an LLM failure to 502', async () => {
        const { LlmError } = await import('../_lib/llm.js');
        chat.mockRejectedValue(new LlmError('x', { code: 'upstream' }));
        expect((await post({ merchants: [{ key: 'a' }] })).statusCode).toBe(502);
    });
});
