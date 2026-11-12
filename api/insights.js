// POST /api/insights
// Body: { aggregates, language?, inputHash?, refresh? }  (aggregates from src/services/insightsAggregates.js, version 2)
// Returns { v: 2, verdict, summary, wins: [{ text, ref }], watchouts: [{ text, ref }], opportunities: [{ id, explanation, howTo }],
//           questions, generalTips, generatedAt, model, cached }  (+ headline = verdict, for clients that still read it)
//
// The app computes, the model explains. Whatever the model returns is checked against the input before it is stored or sent on:
//   - an opportunity explanation is kept only for an id that was sent (O1, O2, ...): the model cannot invent a suggestion;
//   - any sentence that states a number which is not in the input is dropped (the app then shows its own wording);
//   - a `ref` on a win or watch-out must be a finding (N..) or opportunity (O..) id that was sent, else it is cleared.
// Cache: insights_cache (user_id, period) read/written through the user-scoped Supabase client (RLS).
// Env: LLM_* (text model), SUPABASE_*, AI_DAILY_LIMIT_PER_USER.
import { z } from 'zod';
import { route, HttpError } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';
import { consume, recordTokens } from './_lib/ratelimit.js';
import { chat } from './_lib/llm.js';
import { loadPrompt, fillPrompt } from './_lib/prompts.js';
import { hashObject } from '../src/utils/stableHash.js';
import { collectNumbers, figuresNotIn } from '../src/utils/numberGuard.js';

export const MAX_AGGREGATE_BYTES = 80 * 1024;
export const MAX_TOKENS = 2200; // five explanations with how-tos, the verdict and two short lists must fit in any of the 7 languages
export const NARRATIVE_VERSION = 2;

const opportunityId = z.string().regex(/^O\d{1,2}$/);
export const inputSchema = z.object({
    aggregates: z
        .object({
            month: z.string().regex(/^\d{4}-\d{2}$/),
            // v2 additions: optional so a client that has not updated yet keeps working
            opportunities: z.array(z.object({ id: opportunityId, oppKind: z.string().max(40) }).passthrough()).max(8).optional(),
            findings: z.array(z.object({}).passthrough()).max(40).optional(),
            dismissed: z.array(z.object({ oppKind: z.string().max(40) }).passthrough()).max(60).optional(),
            verdict: z.object({}).passthrough().nullable().optional(),
            patterns: z.array(z.object({ id: z.string().regex(/^P\d{1,2}$/), patternKind: z.string().max(40) }).passthrough()).max(6).optional(),
        })
        .passthrough(),
    language: z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/).optional().default('en'),
    inputHash: z.string().regex(/^[0-9a-f]{8,64}$/).optional(),
    refresh: z.boolean().optional().default(false),
});

const clip = (max) => (s) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const text = (max) =>
    z.preprocess(
        (v) => (v && typeof v === 'object' ? v.text ?? v.title ?? v.description ?? '' : v),
        z.string().trim().min(1).transform(clip(max))
    );
const optionalText = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() ? v : undefined), text(max).optional());
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
/** A win or watch-out: a sentence with an optional reference to the finding or opportunity it is about. A bare string is accepted. */
const note = z.preprocess(
    (v) => (typeof v === 'string' ? { text: v } : v && typeof v === 'object' ? { text: v.text ?? v.title ?? v.description, ref: v.ref } : v),
    z.object({ text: text(240), ref: z.preprocess((v) => (typeof v === 'string' && /^[NO]\d{1,2}$/.test(v.trim()) ? v.trim() : null), z.string().nullable()).optional().default(null) })
);
const notes = (items = 3) =>
    z.preprocess(
        (v) => (Array.isArray(v) ? v : []),
        z.array(z.any()).transform((arr) => arr.map((x) => note.safeParse(x)).filter((r) => r.success).map((r) => r.data).slice(0, items))
    );
const explained = z.object({ id: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().max(8)), explanation: text(320), howTo: optionalText(240) });

export const narrativeSchema = z.preprocess(
    // the v1 names are still read: headline -> verdict, concerns -> watchouts
    (v) => (v && typeof v === 'object' ? { ...v, verdict: v.verdict ?? v.headline, watchouts: v.watchouts ?? v.concerns } : v),
    z.object({
        verdict: optionalText(160),
        summary: optionalText(420),
        wins: notes().optional().default([]),
        watchouts: notes().optional().default([]),
        opportunities: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.any()).transform((arr) => arr.map((x) => explained.safeParse(x)).filter((r) => r.success).map((r) => r.data))).optional().default([]),
        questions: list(160, 3).optional().default([]),
        // assistant v2 (B-T4): general advice not derived from the data, shown under a "General tips" label
        generalTips: list(200, 3).optional().default([]),
    })
);

/**
 * Check a parsed narrative against the aggregates it was written from. Never throws.
 * -> { payload: { verdict, summary, wins, watchouts, opportunities, questions }, dropped: [{ where, reason, figures? }] }
 */
export function finalizeNarrative(parsed, aggregates) {
    const known = collectNumbers(aggregates);
    const sentOpps = new Set((aggregates.opportunities || []).map((o) => o.id));
    const sentRefs = new Set([...sentOpps, ...(aggregates.findings || []).map((f) => f.id).filter(Boolean)]);
    const dropped = [];
    const invented = (s) => (s ? figuresNotIn(s, known, { minInteger: 10 }) : []);
    const keep = (s, where) => {
        const bad = invented(s);
        if (bad.length) dropped.push({ where, reason: 'number_not_in_input', figures: bad });
        return bad.length === 0;
    };
    const cleanNotes = (items, where) =>
        items
            .filter((n, i) => keep(n.text, `${where}[${i}]`))
            .map((n) => ({ text: n.text, ref: n.ref && sentRefs.has(n.ref) ? n.ref : null }));

    const seen = new Set();
    const opportunities = [];
    for (const o of parsed.opportunities) {
        if (!sentOpps.has(o.id) || seen.has(o.id)) {
            dropped.push({ where: `opportunities.${o.id}`, reason: seen.has(o.id) ? 'duplicate_id' : 'unknown_id' });
            continue;
        }
        if (!keep(o.explanation, `opportunities.${o.id}.explanation`)) continue; // the whole entry goes: a how-to without its explanation is no use
        seen.add(o.id);
        opportunities.push({ id: o.id, explanation: o.explanation, howTo: o.howTo && keep(o.howTo, `opportunities.${o.id}.howTo`) ? o.howTo : null });
    }
    const verdict = parsed.verdict && keep(parsed.verdict, 'verdict') ? parsed.verdict : null;
    const summary = parsed.summary && keep(parsed.summary, 'summary') ? parsed.summary : null;
    return {
        payload: {
            verdict,
            summary,
            wins: cleanNotes(parsed.wins, 'wins'),
            watchouts: cleanNotes(parsed.watchouts, 'watchouts'),
            opportunities,
            questions: parsed.questions.filter((q, i) => keep(q, `questions[${i}]`)),
            // a general tip never states a figure: one with any number that is not in the input goes
            generalTips: (parsed.generalTips || []).filter((g, i) => keep(g, `generalTips[${i}]`)),
        },
        dropped,
    };
}

const isEmpty = (p) => !p.verdict && !p.summary && p.wins.length === 0 && p.watchouts.length === 0 && p.opportunities.length === 0;

const publicShape = (payload, row, cached) => ({
    v: NARRATIVE_VERSION,
    verdict: payload.verdict ?? payload.headline ?? null,
    headline: payload.verdict ?? payload.headline ?? '', // read by clients from before v2
    summary: payload.summary ?? '',
    wins: payload.wins || [],
    watchouts: payload.watchouts || [],
    opportunities: payload.opportunities || [],
    questions: payload.questions || [],
    generalTips: payload.generalTips || [],
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
    if (!readError && row && row.input_hash === inputHash && !input.refresh && row.payload?.v === NARRATIVE_VERSION) {
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
        maxTokens: MAX_TOKENS,
        temperature: 0.3,
    });

    const parsed = narrativeSchema.safeParse(result.data);
    if (!parsed.success) throw new HttpError(502, 'The AI returned an unusable answer', 'invalid_output');
    const { payload: checked } = finalizeNarrative(parsed.data, input.aggregates);
    await recordTokens(client, userId, 'insights', result.usage);
    if (isEmpty(checked)) throw new HttpError(502, 'The AI returned an unusable answer', 'invalid_output');

    const generatedAt = new Date().toISOString();
    const payload = { v: NARRATIVE_VERSION, ...checked, generatedAt, model: result.model };

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
