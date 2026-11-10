// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { chat, buildEndpoint, parseJsonText, getConfig, NoVisionModelError, LlmError, LlmConfigError } from '../llm.js';

const ENV = {
    LLM_BASE_URL: 'https://api.deepseek.com',
    LLM_API_KEY: 'k-text',
    LLM_MODEL: 'deepseek-chat',
};
const VISION_ENV = {
    ...ENV,
    LLM_VISION_BASE_URL: 'https://openrouter.ai/api/v1',
    LLM_VISION_API_KEY: 'k-vision',
    LLM_VISION_MODEL: 'google/gemini-2.5-flash',
};

const okResponse = (content, extra = {}) => ({
    ok: true,
    status: 200,
    json: async () => ({
        model: 'm',
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        ...extra,
    }),
});
const statusResponse = (status) => ({ ok: false, status, json: async () => ({}) });

describe('buildEndpoint', () => {
    it.each([
        ['https://api.deepseek.com', 'https://api.deepseek.com/v1/chat/completions'],
        ['https://api.deepseek.com/', 'https://api.deepseek.com/v1/chat/completions'],
        ['https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions'],
        ['https://openrouter.ai/api/v1/', 'https://openrouter.ai/api/v1/chat/completions'],
        ['https://generativelanguage.googleapis.com/v1beta/openai', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
        ['http://localhost:11434', 'http://localhost:11434/v1/chat/completions'],
        ['https://x.test/v1/chat/completions', 'https://x.test/v1/chat/completions'],
    ])('%s', (input, expected) => {
        expect(buildEndpoint(input)).toBe(expected);
    });
});

describe('parseJsonText', () => {
    it('parses plain, fenced and prefixed JSON', () => {
        expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
        expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
        expect(parseJsonText('Here you go: {"a":{"b":2}} thanks')).toEqual({ a: { b: 2 } });
    });
    it('throws on garbage', () => {
        expect(() => parseJsonText('nope')).toThrow();
    });
});

describe('getConfig', () => {
    it('returns null when model or base is missing', () => {
        expect(getConfig({ env: {} })).toBeNull();
        expect(getConfig({ vision: true, env: ENV })).toBeNull();
        expect(getConfig({ vision: true, env: VISION_ENV }).model).toBe('google/gemini-2.5-flash');
    });
});

describe('chat', () => {
    it('posts an OpenAI-shaped request and parses JSON', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(okResponse('```json\n{"ok":true}\n```'));
        const out = await chat({
            messages: [{ role: 'user', content: 'return json please' }],
            json: true,
            maxTokens: 200,
            temperature: 0,
            fetchImpl,
            env: ENV,
        });
        expect(out.data).toEqual({ ok: true });
        expect(out.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
        expect(out.model).toBe('m');
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
        expect(init.headers.Authorization).toBe('Bearer k-text');
        const body = JSON.parse(init.body);
        expect(body.model).toBe('deepseek-chat');
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.max_tokens).toBe(200);
        expect(body.temperature).toBe(0);
    });

    it('adds a json hint when the prompt does not mention json', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(okResponse('{"a":1}'));
        await chat({ messages: [{ role: 'user', content: 'hello' }], json: true, fetchImpl, env: ENV });
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(body.messages[0].role).toBe('system');
        expect(body.messages[0].content).toMatch(/json/i);
    });

    it('returns text when json is false', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(okResponse('hello'));
        const out = await chat({ messages: [{ role: 'user', content: 'hi' }], fetchImpl, env: ENV });
        expect(out.data).toBe('hello');
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).response_format).toBeUndefined();
    });

    it('attaches images as image_url data URLs and uses the vision config', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(okResponse('{"x":1}'));
        await chat({
            messages: [{ role: 'user', content: 'read this json' }],
            images: [{ base64: 'AAAA', mime: 'image/png' }, 'data:image/jpeg;base64,BBBB'],
            json: true,
            fetchImpl,
            env: VISION_ENV,
        });
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(init.headers.Authorization).toBe('Bearer k-vision');
        const body = JSON.parse(init.body);
        expect(body.model).toBe('google/gemini-2.5-flash');
        const parts = body.messages[0].content;
        expect(parts[0]).toEqual({ type: 'text', text: 'read this json' });
        expect(parts[1].image_url.url).toBe('data:image/png;base64,AAAA');
        expect(parts[2].image_url.url).toBe('data:image/jpeg;base64,BBBB');
    });

    it('throws NoVisionModelError when vision is requested without vision config', async () => {
        const fetchImpl = vi.fn();
        await expect(
            chat({ messages: [{ role: 'user', content: 'x' }], vision: true, fetchImpl, env: ENV })
        ).rejects.toBeInstanceOf(NoVisionModelError);
        await expect(
            chat({ messages: [{ role: 'user', content: 'x' }], images: ['AAAA'], fetchImpl, env: ENV })
        ).rejects.toBeInstanceOf(NoVisionModelError);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('throws LlmConfigError when the text model is not configured', async () => {
        await expect(chat({ messages: [{ role: 'user', content: 'x' }], env: {} })).rejects.toBeInstanceOf(LlmConfigError);
    });

    it('retries once on 429/5xx then succeeds', async () => {
        const fetchImpl = vi.fn().mockResolvedValueOnce(statusResponse(429)).mockResolvedValueOnce(okResponse('ok'));
        const out = await chat({ messages: [{ role: 'user', content: 'x' }], fetchImpl, env: ENV, retryDelayMs: 1 });
        expect(out.data).toBe('ok');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('gives up after one retry', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(statusResponse(503));
        await expect(
            chat({ messages: [{ role: 'user', content: 'x' }], fetchImpl, env: ENV, retryDelayMs: 1 })
        ).rejects.toMatchObject({ name: 'LlmError', upstreamStatus: 503 });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 400', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(statusResponse(400));
        await expect(chat({ messages: [{ role: 'user', content: 'x' }], fetchImpl, env: ENV })).rejects.toBeInstanceOf(LlmError);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('times out', async () => {
        const fetchImpl = vi.fn(
            (url, init) =>
                new Promise((_, reject) => {
                    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
                })
        );
        await expect(
            chat({ messages: [{ role: 'user', content: 'x' }], fetchImpl, env: ENV, timeoutMs: 10, retryDelayMs: 1 })
        ).rejects.toMatchObject({ code: 'timeout' });
    });

    it('validates with a zod schema', async () => {
        const schema = z.object({ n: z.number() });
        const good = vi.fn().mockResolvedValue(okResponse('{"n":3}'));
        const out = await chat({ messages: [{ role: 'user', content: 'json' }], json: true, schema, fetchImpl: good, env: ENV });
        expect(out.data).toEqual({ n: 3 });
        const bad = vi.fn().mockResolvedValue(okResponse('{"n":"x"}'));
        await expect(
            chat({ messages: [{ role: 'user', content: 'json' }], json: true, schema, fetchImpl: bad, env: ENV })
        ).rejects.toMatchObject({ code: 'invalid_output' });
    });

    it('reports invalid JSON', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(okResponse('definitely not json'));
        await expect(
            chat({ messages: [{ role: 'user', content: 'json' }], json: true, fetchImpl, env: ENV })
        ).rejects.toMatchObject({ code: 'invalid_json' });
    });
});
