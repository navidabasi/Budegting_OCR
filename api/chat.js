// POST /api/chat
// Body: { aggregates, messages: [{ role: 'user'|'assistant', content }] (last <= 10 used), language? }
// Returns { answer, suggestedAction: null | { type, payload }, model }
// The assistant never writes data: suggestedAction only describes a pre-filled screen for the client to open.
// Env: LLM_* (text model), SUPABASE_*, AI_DAILY_LIMIT_PER_USER.
import { z } from 'zod';
import { route, HttpError } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';
import { consume, recordTokens } from './_lib/ratelimit.js';
import { chat } from './_lib/llm.js';
import { loadPrompt, fillPrompt } from './_lib/prompts.js';

export const MAX_TURNS = 10;
export const MAX_AGGREGATE_BYTES = 120 * 1024;

const inputSchema = z.object({
    aggregates: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).passthrough(),
    messages: z
        .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(1500) }))
        .min(1)
        .max(60),
    language: z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/).optional().default('en'),
});

const month = z.string().regex(/^\d{4}-\d{2}$/);
const amount = z.number().finite().positive().max(10_000_000);
const actionPayloads = {
    set_budget: z.object({ category: z.string().trim().min(1).max(40), amount }).strict(),
    open_filter: z
        .object({
            screen: z.enum(['activity', 'budgets', 'savings']).optional().default('activity'),
            category: z.string().trim().min(1).max(40).optional(),
            merchant: z.string().trim().min(1).max(80).optional(),
            month: z.union([month, z.literal('all')]).optional(),
        })
        .strict(),
    add_goal: z
        .object({
            name: z.string().trim().min(1).max(60),
            targetAmount: amount,
            targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .strict(),
};

/** Returns a clean { type, payload } or null. Unknown types or invalid payloads are dropped, never thrown. */
export function sanitizeAction(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const schema = actionPayloads[raw.type];
    if (!schema) return null;
    const parsed = schema.safeParse(raw.payload);
    return parsed.success ? { type: raw.type, payload: parsed.data } : null;
}

const outputSchema = z.object({
    answer: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(1500)),
    suggestedAction: z.any().optional(),
});

export const handle = async ({ req, body }) => {
    const { userId, client } = await requireUser(req);
    const input = inputSchema.parse(body);
    if (Buffer.byteLength(JSON.stringify(input.aggregates)) > MAX_AGGREGATE_BYTES) {
        throw new HttpError(413, 'Aggregates too large', 'payload_too_large');
    }
    const turns = input.messages.slice(-MAX_TURNS);
    if (turns[turns.length - 1].role !== 'user') {
        throw new HttpError(400, 'The last message must be from the user', 'invalid_request');
    }
    // The model API wants the conversation to start with a user turn.
    while (turns.length > 1 && turns[0].role !== 'user') turns.shift();

    await consume(client, userId, 'chat');

    const system = fillPrompt(loadPrompt('chat'), { LANGUAGE: input.language });
    const result = await chat({
        messages: [
            { role: 'system', content: system },
            { role: 'system', content: `Aggregates (json, read-only context):\n${JSON.stringify(input.aggregates)}` },
            ...turns,
        ],
        json: true,
        maxTokens: 700,
        temperature: 0.2,
    });

    const parsed = outputSchema.safeParse(result.data);
    if (!parsed.success) throw new HttpError(502, 'The AI returned an unusable answer', 'invalid_output');
    await recordTokens(client, userId, 'chat', result.usage);

    return {
        answer: parsed.data.answer,
        suggestedAction: sanitizeAction(parsed.data.suggestedAction),
        model: result.model,
    };
};

export default route({ methods: ['POST'], handle });
