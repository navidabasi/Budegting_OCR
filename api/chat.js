// POST /api/chat
// Body: { aggregates | evidence, messages: [{ role: 'user'|'assistant', content }] (last <= 10 used), language? }
//   evidence = the pack built on the device (src/services/evidencePack.js): facts (F..) and supporting records (R..), numbers already computed
// Returns { answer, suggestedAction: null | { type, payload }, model } and, for an evidence pack,
//   { citations: F-ids that exist in the pack, uncertain: F-ids, proposals: [bookkeeping proposals pointing at R-ids], grounded: boolean,
//     generalTips: string[] (general advice not derived from the data, only for intents that allow it, sanitized) }
// The assistant never writes data: suggestedAction only describes a pre-filled screen for the client to open.
// Env: LLM_* (text model), SUPABASE_*, AI_DAILY_LIMIT_PER_USER.
import { z } from 'zod';
import { route, HttpError } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';
import { consume, recordTokens } from './_lib/ratelimit.js';
import { chat } from './_lib/llm.js';
import { loadPrompt, fillPrompt } from './_lib/prompts.js';
import { collectNumbers, figuresNotIn } from '../src/utils/numberGuard.js';

export const MAX_TURNS = 10;
export const MAX_AGGREGATE_BYTES = 120 * 1024;

const factId = z.string().regex(/^F\d{1,3}$/);
const refId = z.string().regex(/^R\d{1,3}$/);
const evidenceSchema = z
    .object({
        intent: z.string().max(40),
        period: z.object({}).passthrough(),
        currency: z.string().max(8),
        basis: z.enum(['share', 'full']),
        coverage: z.object({}).passthrough().nullable().optional(),
        facts: z.array(z.object({ id: factId, kind: z.string().max(40) }).passthrough()).max(60),
        evidence: z.array(z.object({ id: refId }).passthrough()).max(40),
        insufficient: z.string().max(60).nullable().optional(),
    })
    .passthrough();

export const inputSchema = z.object({
    aggregates: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).passthrough().optional(),
    evidence: evidenceSchema.optional(),
    messages: z
        .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(1500) }))
        .min(1)
        .max(60),
    language: z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/).optional().default('en'),
}).refine((v) => v.aggregates || v.evidence, { message: 'aggregates or evidence required' });

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
    // assistant v2 (A-T3): a deep link to one of the app's own screens; the client checks it against its route table again
    open_screen: z
        .object({ path: z.string().regex(/^\/[a-z0-9/?=&-]{0,60}$/).refine((p) => !p.startsWith('//'), 'not a local path') })
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

const PROPOSAL_TYPES = ['recategorise', 'mark_duplicate', 'create_recurring', 'prepare_correction'];
const proposalSchema = z.object({
    type: z.enum(PROPOSAL_TYPES),
    ref: refId,
    toRef: refId.optional(),
    category: z.string().trim().min(1).max(40).optional(),
    frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
    note: z.string().trim().max(160).optional(),
});

/** Keep only well-formed proposals that point at evidence ids that exist in the pack (max 3). Never throws. */
export function sanitizeProposals(raw, evidence) {
    const ids = new Set((evidence?.evidence || []).map((e) => e.id));
    return (Array.isArray(raw) ? raw : [])
        .map((p) => proposalSchema.safeParse(p))
        .filter((r) => r.success && ids.has(r.data.ref) && (!r.data.toRef || ids.has(r.data.toRef)))
        .filter((r) => (r.data.type === 'recategorise' ? !!r.data.category : r.data.type === 'mark_duplicate' ? !!r.data.toRef : true))
        .map((r) => r.data)
        .slice(0, 3);
}

/** Citation ids that exist among the pack's facts (the model must cite what it used). */
export function sanitizeCitations(raw, evidence) {
    const ids = new Set((evidence?.facts || []).map((f) => f.id));
    return [...new Set((Array.isArray(raw) ? raw : []).filter((c) => typeof c === 'string' && ids.has(c)))];
}

// Intents whose answer may teach a concept or walk through the app: a longer answer is allowed (assistant v2, A-T4)
export const GUIDANCE_INTENTS = ['explain', 'app_help'];
// Intents that may add clearly labeled general tips beside the grounded answer
export const TIP_INTENTS = ['save_money', 'explain', 'afford', 'patterns'];
export const MAX_TIPS = 3;
export const MAX_TIP_CHARS = 200;
const answerCap = (intent) => (GUIDANCE_INTENTS.includes(intent) ? 2000 : 1500);

/**
 * General tips (not derived from the data): trimmed, at most 3 of at most 200 chars, only for intents that allow them. A tip that
 * states an amount of 100 or more that is not in the pack is dropped: a tip may never smuggle in an invented figure about the owner.
 */
export function sanitizeGeneralTips(raw, evidence) {
    if (!evidence || !TIP_INTENTS.includes(evidence.intent) || !Array.isArray(raw)) return [];
    const known = collectNumbers(evidence.facts || [], { strings: false });
    return raw
        .filter((t) => typeof t === 'string')
        .map((t) => t.replace(/\s+/g, ' ').trim())
        .filter((t) => t.length > 0 && t.length <= MAX_TIP_CHARS)
        .filter((t) => figuresNotIn(t, known, { minInteger: 100 }).every((f) => Number(f.replace(/[^\d.,]/g, '').replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.')) < 100))
        .slice(0, MAX_TIPS);
}

const outputSchema = (cap) =>
    z.object({
        answer: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).max(cap)),
        suggestedAction: z.any().optional(),
        citations: z.any().optional(),
        uncertain: z.any().optional(),
        proposals: z.any().optional(),
        generalTips: z.any().optional(),
    });

export const handle = async ({ req, body }) => {
    const { userId, client } = await requireUser(req);
    const input = inputSchema.parse(body);
    if (Buffer.byteLength(JSON.stringify(input.aggregates || input.evidence)) > MAX_AGGREGATE_BYTES) {
        throw new HttpError(413, 'Aggregates too large', 'payload_too_large');
    }
    const turns = input.messages.slice(-MAX_TURNS);
    if (turns[turns.length - 1].role !== 'user') {
        throw new HttpError(400, 'The last message must be from the user', 'invalid_request');
    }
    // The model API wants the conversation to start with a user turn.
    while (turns.length > 1 && turns[0].role !== 'user') turns.shift();

    await consume(client, userId, 'chat');

    const { output, usage } = await answer(input, turns);
    await recordTokens(client, userId, 'chat', usage);
    return output;
};

/**
 * The model call and every check on its output, without auth or rate limits: shared by the endpoint and scripts/eval-chat.mjs so
 * the eval grades exactly what users get. `turns`: the conversation, already trimmed. -> { output, usage }
 */
export async function answer(input, turns, { chatImpl = chat } = {}) {
    const system = fillPrompt(loadPrompt(input.evidence ? 'chat-evidence' : 'chat'), { LANGUAGE: input.language });
    const context = input.evidence
        ? `Evidence pack (json, read-only; every number was computed by the app):\n${JSON.stringify(input.evidence)}`
        : `Aggregates (json, read-only context):\n${JSON.stringify(input.aggregates)}`;
    const result = await chatImpl({
        messages: [{ role: 'system', content: system }, { role: 'system', content: context }, ...turns],
        json: true,
        // the json answer, its citations and up to three proposals must fit: a cut-off answer is an unusable one
        maxTokens: input.evidence ? 1500 : 700,
        temperature: 0.2,
    });

    const parsed = outputSchema(input.evidence ? answerCap(input.evidence.intent) : 1500).safeParse(result.data);
    if (!parsed.success) throw new HttpError(502, 'The AI returned an unusable answer', 'invalid_output');

    const citations = input.evidence ? sanitizeCitations(parsed.data.citations, input.evidence) : [];
    return {
        usage: result.usage,
        output: {
            answer: parsed.data.answer,
            suggestedAction: sanitizeAction(parsed.data.suggestedAction),
            ...(input.evidence
                ? {
                      citations,
                      uncertain: sanitizeCitations(parsed.data.uncertain, input.evidence).filter((id) => citations.includes(id)),
                      proposals: sanitizeProposals(parsed.data.proposals, input.evidence),
                      grounded: citations.length > 0,
                      generalTips: sanitizeGeneralTips(parsed.data.generalTips, input.evidence),
                  }
                : {}),
            model: result.model,
        },
    };
}

export default route({ methods: ['POST'], handle });
