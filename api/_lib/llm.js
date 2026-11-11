// Provider-agnostic chat client for any OpenAI-compatible Chat Completions API.
//
// Env (server only, never VITE_*):
//   LLM_BASE_URL / LLM_API_KEY / LLM_MODEL                   text model
//   LLM_VISION_BASE_URL / LLM_VISION_API_KEY / LLM_VISION_MODEL   vision model
// The vision model never falls back to the text model: if the vision vars are unset,
// `vision: true` throws NoVisionModelError so callers can use OCR text + text model instead.

export class LlmConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LlmConfigError';
    }
}

export class NoVisionModelError extends Error {
    constructor(message = 'No vision model is configured (LLM_VISION_* env vars)') {
        super(message);
        this.name = 'NoVisionModelError';
    }
}

export class LlmError extends Error {
    constructor(message, { code = 'llm_error', upstreamStatus } = {}) {
        super(message);
        this.name = 'LlmError';
        this.code = code;
        this.upstreamStatus = upstreamStatus;
    }
}

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/** Read the text or vision config from env. Returns null when not fully configured. */
export function getConfig({ vision = false, env = process.env } = {}) {
    const prefix = vision ? 'LLM_VISION_' : 'LLM_';
    const baseUrl = clean(env[`${prefix}BASE_URL`]);
    const apiKey = clean(env[`${prefix}API_KEY`]);
    const model = clean(env[`${prefix}MODEL`]);
    if (!baseUrl || !model) return null;
    // DeepSeek models reason by default, and reasoning tokens count against max_tokens: with a
    // modest limit the model can spend the whole budget thinking and return an empty answer.
    // Thinking is therefore off unless LLM_THINKING / LLM_VISION_THINKING is "enabled".
    const thinkingSetting = clean(env[`${prefix}THINKING`]).toLowerCase();
    const isDeepSeek = /(^|\.)deepseek\.com/i.test(hostOf(baseUrl)) || /^deepseek/i.test(model);
    const disableThinking = isDeepSeek && thinkingSetting !== 'enabled';
    return { baseUrl, apiKey, model, disableThinking };
}

function hostOf(url) {
    try {
        return new URL(url).host;
    } catch {
        return '';
    }
}

export function hasVisionModel(env = process.env) {
    return getConfig({ vision: true, env }) !== null;
}

/**
 * Accepts bases with or without a version segment:
 *   https://api.deepseek.com                       -> /v1/chat/completions
 *   https://api.openai.com/v1                      -> /chat/completions
 *   https://openrouter.ai/api/v1/                  -> /chat/completions
 *   https://generativelanguage.googleapis.com/v1beta/openai -> /chat/completions
 *   http://localhost:11434                         -> /v1/chat/completions
 */
export function buildEndpoint(baseUrl) {
    const base = baseUrl.replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(base)) return base;
    if (/\/v\d+(beta\d*|alpha\d*)?(\/openai)?$/.test(base) || /\/openai$/.test(base)) {
        return `${base}/chat/completions`;
    }
    return `${base}/v1/chat/completions`;
}

/** Remove ``` fences and parse JSON; falls back to the outermost {...} / [...] slice. */
export function parseJsonText(text) {
    if (typeof text !== 'string') throw new Error('empty');
    let t = text.trim();
    const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) t = fence[1].trim();
    try {
        return JSON.parse(t);
    } catch (firstErr) {
        const start = t.search(/[{[]/);
        const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
        if (start >= 0 && end > start) {
            return JSON.parse(t.slice(start, end + 1));
        }
        throw firstErr;
    }
}

const toImageUrl = (img) => {
    if (typeof img === 'string') {
        return img.startsWith('data:') || /^https?:/.test(img) ? img : `data:image/jpeg;base64,${img}`;
    }
    return `data:${img.mime || 'image/jpeg'};base64,${img.base64}`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * chat({ messages, json, images, vision, maxTokens, temperature, schema })
 *   messages     [{ role, content }]
 *   json         ask for a JSON object and return it parsed in `data`
 *   images       data URLs / base64 strings / { base64, mime }; attached to the last user message
 *   vision       use the vision model (implied by images)
 *   schema       optional zod schema validated against the parsed JSON
 * Returns { data, usage, model, durationMs } where data is the parsed JSON or the text.
 */
export async function chat({
    messages,
    json = false,
    images = [],
    vision = false,
    maxTokens,
    temperature = 0.1,
    schema,
    timeoutMs = 25000,
    retryDelayMs = 600,
    fetchImpl,
    env = process.env,
} = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new LlmError('messages are required', { code: 'bad_request' });
    }
    const useVision = Boolean(vision) || images.length > 0;
    const config = getConfig({ vision: useVision, env });
    if (!config) {
        if (useVision) throw new NoVisionModelError();
        throw new LlmConfigError('LLM_BASE_URL and LLM_MODEL are not set');
    }

    let outMessages = messages.map((m) => ({ ...m }));
    if (json && !outMessages.some((m) => typeof m.content === 'string' && /json/i.test(m.content))) {
        // DeepSeek and OpenAI require the word "json" in the prompt for json_object mode.
        outMessages.unshift({ role: 'system', content: 'Respond with a single valid JSON object only.' });
    }
    if (images.length > 0) {
        let idx = -1;
        for (let i = outMessages.length - 1; i >= 0; i--) {
            if (outMessages[i].role === 'user') {
                idx = i;
                break;
            }
        }
        if (idx === -1) {
            outMessages.push({ role: 'user', content: '' });
            idx = outMessages.length - 1;
        }
        const text = outMessages[idx].content;
        outMessages[idx] = {
            role: 'user',
            content: [
                ...(text ? [{ type: 'text', text }] : []),
                ...images.map((img) => ({ type: 'image_url', image_url: { url: toImageUrl(img) } })),
            ],
        };
    }

    const body = { model: config.model, messages: outMessages, temperature };
    if (maxTokens) body.max_tokens = maxTokens;
    if (json) body.response_format = { type: 'json_object' };
    if (config.disableThinking) body.thinking = { type: 'disabled' };

    const doFetch = fetchImpl || globalThis.fetch;
    const url = buildEndpoint(config.baseUrl);
    const started = Date.now();

    let response;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            response = await doFetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timer);
            if ((response.status === 429 || response.status >= 500) && attempt === 0) {
                lastError = new LlmError(`Upstream ${response.status}`, { upstreamStatus: response.status });
                await sleep(retryDelayMs);
                continue;
            }
            lastError = undefined;
            break;
        } catch (err) {
            clearTimeout(timer);
            const timedOut = err?.name === 'AbortError';
            lastError = new LlmError(timedOut ? 'LLM request timed out' : `LLM request failed: ${err?.message}`, {
                code: timedOut ? 'timeout' : 'network',
            });
            if (attempt === 0) {
                await sleep(retryDelayMs);
                continue;
            }
        }
    }
    if (lastError) throw lastError;

    if (!response.ok) {
        let detail = '';
        try {
            const errBody = await response.json();
            detail = errBody?.error?.message || errBody?.message || '';
        } catch {
            /* body is optional */
        }
        console.error('[llm] upstream error', response.status, config.model, String(detail).slice(0, 300));
        throw new LlmError(`LLM upstream error ${response.status}`, {
            code: response.status === 429 ? 'rate_limited' : 'upstream',
            upstreamStatus: response.status,
        });
    }

    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new LlmError('LLM returned a non-JSON response', { code: 'bad_response' });
    }
    const choice = payload?.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== 'string' || text.length === 0) {
        const truncated = choice?.finish_reason === 'length';
        console.error('[llm] no answer', config.model, 'finish_reason=', choice?.finish_reason, 'usage=', JSON.stringify(payload?.usage || {}));
        throw new LlmError(truncated ? 'LLM answer was cut off by the token limit' : 'LLM returned an empty response', {
            code: truncated ? 'truncated' : 'empty',
        });
    }

    let data = text;
    if (json) {
        try {
            data = parseJsonText(text);
        } catch {
            console.error('[llm] invalid JSON', config.model, 'finish_reason=', choice?.finish_reason, text.slice(0, 200));
            throw new LlmError('LLM returned invalid JSON', { code: 'invalid_json' });
        }
        if (schema) {
            const parsed = schema.safeParse(data);
            if (!parsed.success) {
                throw new LlmError('LLM output failed validation', { code: 'invalid_output' });
            }
            data = parsed.data;
        }
    }

    const u = payload.usage || {};
    return {
        data,
        usage: {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
        },
        model: payload.model || config.model,
        durationMs: Date.now() - started,
    };
}
