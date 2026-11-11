// POST /api/insights
// Body: { aggregates, language?, inputHash?, refresh? }  (aggregates from src/services/insightsAggregates.js)
// Returns { headline, summary, wins, concerns, actions, questions, generatedAt, model, cached }
// Cache: insights_cache (user_id, period) read/written through the user-scoped Supabase client (RLS).
// Env: LLM_* (text model), SUPABASE_*, AI_DAILY_LIMIT_PER_USER.
import { z } from 'zod';
import { route, HttpError } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';
import { consume, recordTokens } from './_lib/ratelimit.js';
import { chat } from './_lib/llm.js';
import { loadPrompt, fillPrompt } from './_lib/prompts.js';
import { hashObject } from '../src/utils/stableHash.js';

export const MAX_AGGREGATE_BYTES = 80 * 1024;

export const inputSchema = z.object({
    aggregates: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).passthrough(),
    language: z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/).optional().default('en'),
    inputHash: z.string().regex(/^[0-9a-f]{8,64}$/).optional(),
    refresh: z.boolean().optional().default(false),
});

const text = (max) =>
    z.preprocess(
        (v) => (v && typeof v === 'object' ? v.text ?? v.title ?? v.description ?? '' : v),
        z.string().trim().min(1).transform((s) => (s.length > max ? `${s.slice(0, max - 1)}...` : s))
    );
const list = (max, items = 3) =>
    z.preprocess(
        (v) => (Array.isArray(v) ? v : []),
        z.array(z.any()).transform((arr) =>
            arr
                .map((x) => text(max).safeParse(x))
                .filter((r) => r.success)
                .map((r) => r.data)
                .slice(0, items)
        )
    );

export const narrativeSchema = z.object({
    headline: text(140),
    summary: text(600),
    wins: list(240).optional().default([]),
    concerns: list(240).optional().default([]),
    actions: list(240).optional().default([]),
    questions: list(160, 2).optional().default([]),
});

const publicShape = (payload, row, cached) => ({
    headline: payload.headline,
    summary: payload.summary,
    wins: payload.wins || [],
    concerns: payload.concerns || [],
    actions: payload.actions || [],
    questions: payload.questions || [],
    generatedAt: payload.generatedAt || row?.created_at || null,
    model: payload.model || row?.model || null,
    cached,
});

export const handle = async ({ req, body }) => {
    const { userId, client } = await requireUser(req);
    const input = inputSchema.parse(body);
    const size = Buffer.byteLength(JSON.stringify(input.aggregates));
    if (size > MAX_AGGREGATE_BYTES) throw new HttpError(413, 'Aggregates too large', 'payload_too_large');

    const period = input.aggregates.month;
    const inputHash = `${input.inputHash || hashObject(input.aggregates)}:${input.language}`;

    const { data: row, error: readError } = await client
        .from('insights_cache')
        .select('input_hash, payload, model, created_at')
        .eq('user_id', userId)
        .eq('period', period)
        .maybeSingle();
    if (!readError && row && row.input_hash === inputHash && !input.refresh && row.payload?.headline) {
        return publicShape(row.payload, row, true);
    }

    await consume(client, userId, 'insights');

    const system = fillPrompt(loadPrompt('insights'), { LANGUAGE: input.language });
    const result = await chat({
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: `Aggregates (json):\n${JSON.stringify(input.aggregates)}` },
        ],
        json: true,
        maxTokens: 900,
        temperature: 0.3,
    });

    const parsed = narrativeSchema.safeParse(result.data);
    if (!parsed.success) throw new HttpError(502, 'The AI returned an unusable answer', 'invalid_output');

    const generatedAt = new Date().toISOString();
    const payload = { ...parsed.data, generatedAt, model: result.model };
    await recordTokens(client, userId, 'insights', result.usage);

    try {
        await client
            .from('insights_cache')
            .upsert({ user_id: userId, period, input_hash: inputHash, payload, model: result.model, created_at: generatedAt }, { onConflict: 'user_id,period' });
    } catch {
        /* caching is best effort */
    }

    return publicShape(payload, null, false);
};

export default route({ methods: ['POST'], handle });
