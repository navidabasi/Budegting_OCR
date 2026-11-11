// POST /api/categorize
// Body: { merchants: [{ key, name?, description?, sampleItems?: string[], amount? }] (<= 50), categories?: string[] }
// Returns { results: [{ key, category, confidence }] } - categories restricted to the provided list.
// Env: LLM_BASE_URL / LLM_API_KEY / LLM_MODEL, SUPABASE_*, AI_DAILY_LIMIT_PER_USER.
import { z } from 'zod';
import { route, HttpError } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';
import { consume, recordTokens } from './_lib/ratelimit.js';
import { chat } from './_lib/llm.js';
import { loadPrompt, fillPrompt } from './_lib/prompts.js';
import { EXPENSE_CATEGORIES, FALLBACK_CATEGORY, canonicalCategory } from '../src/utils/categoryNames.js';

export const MAX_MERCHANTS = 50;

export const inputSchema = z.object({
    merchants: z
        .array(
            z.object({
                key: z.string().trim().min(1).max(120),
                name: z.string().max(160).optional(),
                description: z.string().max(240).optional(),
                sampleItems: z.array(z.string().max(80)).max(6).optional(),
                amount: z.number().finite().optional(),
            })
        )
        .min(1)
        .max(MAX_MERCHANTS),
    categories: z.array(z.string().trim().min(1).max(40)).min(1).max(60).optional(),
});

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Align model output with the input: same keys/order, canonical allowed categories, clamped confidence. */
export function sanitizeResults(raw, merchants, categories) {
    const list = Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : [];
    const byKey = new Map();
    for (const r of list) {
        if (r && typeof r.key === 'string' && !byKey.has(r.key)) byKey.set(r.key, r);
    }
    const fallback = canonicalCategory(FALLBACK_CATEGORY, categories) || categories[categories.length - 1];
    return merchants.map(({ key }) => {
        const r = byKey.get(key);
        const category = canonicalCategory(r?.category, categories);
        if (!r || !category) return { key, category: fallback, confidence: 0 };
        return { key, category, confidence: Math.round(clamp01(Number(r.confidence)) * 100) / 100 };
    });
}

export const handle = async ({ req, body }) => {
    const { userId, client } = await requireUser(req);
    const input = inputSchema.parse(body);
    const seen = new Set();
    const merchants = input.merchants.filter((m) => (seen.has(m.key) ? false : seen.add(m.key)));
    const categories = input.categories?.length ? [...new Set(input.categories)] : EXPENSE_CATEGORIES;
    if (!categories.length) throw new HttpError(400, 'No categories', 'invalid_request');

    await consume(client, userId, 'categorize');

    const system = fillPrompt(loadPrompt('categorize'), { CATEGORIES: categories.join(', ') });
    const result = await chat({
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: `Classify these merchants. Answer with the json object.\n${JSON.stringify({ merchants })}` },
        ],
        json: true,
        maxTokens: 60 + merchants.length * 40,
        temperature: 0,
    });
    await recordTokens(client, userId, 'categorize', result.usage);

    return { results: sanitizeResults(result.data, merchants, categories), model: result.model };
};

export default route({ methods: ['POST'], handle });
