// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireUser, getBearerToken } from '../auth.js';
import { consume, getDailyLimit, recordTokens } from '../ratelimit.js';
import { route, readJsonBody, isOriginAllowed, HttpError, errorToResponse } from '../http.js';
import { NoVisionModelError, LlmError } from '../llm.js';
import { fakeReq, fakeRes, fakeSupabase } from './testUtils.js';

beforeEach(() => {
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
});

describe('auth.requireUser', () => {
    const makeFactory = (getUser) => {
        const calls = [];
        const impl = vi.fn((url, key, opts) => {
            calls.push({ url, key, opts });
            return { auth: { getUser }, marker: calls.length };
        });
        return { impl, calls };
    };

    it('401 without a token', async () => {
        await expect(requireUser(fakeReq({ headers: {} }))).rejects.toMatchObject({ status: 401 });
    });

    it('extracts bearer tokens', () => {
        expect(getBearerToken({ headers: { authorization: 'Bearer abc.def' } })).toBe('abc.def');
        expect(getBearerToken({ headers: { authorization: 'Basic abc' } })).toBe('');
    });

    it('401 for an invalid token', async () => {
        const { impl } = makeFactory(async () => ({ data: { user: null }, error: { message: 'bad' } }));
        await expect(
            requireUser(fakeReq({ headers: { authorization: 'Bearer bad' } }), { createClientImpl: impl })
        ).rejects.toMatchObject({ status: 401 });
    });

    it('returns the user and a user-scoped client', async () => {
        const getUser = vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null }));
        const { impl, calls } = makeFactory(getUser);
        const out = await requireUser(fakeReq({ headers: { authorization: 'Bearer tok' } }), { createClientImpl: impl });
        expect(getUser).toHaveBeenCalledWith('tok');
        expect(out.userId).toBe('u1');
        expect(calls[0].url).toBe('https://x.supabase.co');
        expect(calls[1].opts.global.headers.Authorization).toBe('Bearer tok');
        expect(out.client.marker).toBe(2);
    });

    it('falls back to VITE_ env vars', async () => {
        delete process.env.SUPABASE_URL;
        delete process.env.SUPABASE_ANON_KEY;
        process.env.VITE_SUPABASE_URL = 'https://vite.supabase.co';
        process.env.VITE_SUPABASE_ANON_KEY = 'vite-anon';
        const { impl, calls } = makeFactory(async () => ({ data: { user: { id: 'u' } }, error: null }));
        await requireUser(fakeReq({ headers: { authorization: 'Bearer t' } }), { createClientImpl: impl });
        expect(calls[0]).toMatchObject({ url: 'https://vite.supabase.co', key: 'vite-anon' });
        delete process.env.VITE_SUPABASE_URL;
        delete process.env.VITE_SUPABASE_ANON_KEY;
    });
});

describe('ratelimit.consume', () => {
    const now = new Date('2026-11-10T10:00:00Z');

    it('increments calls per kind and allows below the limit', async () => {
        const client = fakeSupabase();
        const a = await consume(client, 'u1', 'extract', { now, limit: 3 });
        const b = await consume(client, 'u1', 'extract', { now, limit: 3 });
        expect(a.used).toBe(1);
        expect(b.used).toBe(2);
        expect(client.tables.ai_usage).toEqual([{ user_id: 'u1', day: '2026-11-10', kind: 'extract', calls: 2 }]);
    });

    it('throws 429 when the daily total (all kinds) reaches the limit', async () => {
        const client = fakeSupabase({
            ai_usage: [
                { user_id: 'u1', day: '2026-11-10', kind: 'extract', calls: 2 },
                { user_id: 'u1', day: '2026-11-10', kind: 'chat', calls: 1 },
            ],
        });
        await expect(consume(client, 'u1', 'insights', { now, limit: 3 })).rejects.toMatchObject({ status: 429 });
        expect(client.tables.ai_usage).toHaveLength(2);
    });

    it('ignores other users and other days', async () => {
        const client = fakeSupabase({
            ai_usage: [
                { user_id: 'u2', day: '2026-11-10', kind: 'extract', calls: 99 },
                { user_id: 'u1', day: '2026-11-09', kind: 'extract', calls: 99 },
            ],
        });
        await expect(consume(client, 'u1', 'extract', { now, limit: 3 })).resolves.toMatchObject({ used: 1 });
    });

    it('reads the limit from the environment', () => {
        expect(getDailyLimit({})).toBe(100);
        expect(getDailyLimit({ AI_DAILY_LIMIT_PER_USER: '7' })).toBe(7);
        expect(getDailyLimit({ AI_DAILY_LIMIT_PER_USER: 'zzz' })).toBe(100);
    });

    it('records tokens', async () => {
        const client = fakeSupabase();
        await consume(client, 'u1', 'chat', { now });
        await recordTokens(client, 'u1', 'chat', { promptTokens: 10, completionTokens: 4 }, { now });
        expect(client.tables.ai_usage[0]).toMatchObject({ calls: 1, tokens_in: 10, tokens_out: 4 });
    });
});

describe('http', () => {
    it('same-origin check', () => {
        expect(isOriginAllowed({ headers: { host: 'app.test' } })).toBe(true);
        expect(isOriginAllowed({ headers: { host: 'app.test', origin: 'https://app.test' } })).toBe(true);
        expect(isOriginAllowed({ headers: { host: 'app.test', origin: 'https://evil.test' } })).toBe(false);
        expect(isOriginAllowed({ headers: { host: 'app.test', origin: 'http://localhost:5173' } })).toBe(true);
    });

    it('readJsonBody enforces size and parses strings', () => {
        expect(readJsonBody({ headers: {}, body: '{"a":1}' })).toEqual({ a: 1 });
        expect(() => readJsonBody({ headers: {}, body: '{bad' })).toThrow(HttpError);
        expect(() => readJsonBody({ headers: { 'content-length': String(13 * 1024 * 1024) }, body: {} })).toThrow(/too large/);
        expect(() => readJsonBody({ headers: {}, body: 'x'.repeat(100) }, 50)).toThrow(/too large/);
    });

    it('maps errors to statuses', () => {
        expect(errorToResponse(new HttpError(429, 'x')).status).toBe(429);
        expect(errorToResponse(new NoVisionModelError()).status).toBe(503);
        expect(errorToResponse(new LlmError('x', { code: 'timeout' })).status).toBe(504);
        expect(errorToResponse(new LlmError('x')).status).toBe(502);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(errorToResponse(new Error('boom')).status).toBe(500);
    });

    it('route: 405, 403, OPTIONS, success and thrown errors', async () => {
        const handler = route({
            methods: ['POST'],
            handle: async ({ body }) => {
                if (body.fail) throw new HttpError(418, 'teapot');
                return { echo: body.v };
            },
        });
        let res = fakeRes();
        await handler(fakeReq({ method: 'GET' }), res);
        expect(res.statusCode).toBe(405);

        res = fakeRes();
        await handler(fakeReq({ headers: { origin: 'https://evil.test' } }), res);
        expect(res.statusCode).toBe(403);

        res = fakeRes();
        await handler(fakeReq({ method: 'OPTIONS', headers: { origin: 'https://app.test' } }), res);
        expect(res.statusCode).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe('https://app.test');

        res = fakeRes();
        await handler(fakeReq({ body: { v: 5 } }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ echo: 5 });

        res = fakeRes();
        await handler(fakeReq({ body: { fail: true } }), res);
        expect(res.statusCode).toBe(418);
    });
});
