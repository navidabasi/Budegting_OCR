// Client for POST /api/insights (plan P6-T3). The request carries aggregates only (insightsAggregates.js).
import { hashAggregates } from './insightsAggregates';
import { postAi } from './aiClient';

export const INSIGHTS_ENDPOINT = '/api/insights';

/** Body per api/insights.js: { aggregates, language, inputHash, refresh? }. inputHash is the clock-independent hash. */
export function buildInsightsRequest({ aggregates, language = 'en', refresh = false }) {
    return { aggregates, language, inputHash: hashAggregates(aggregates), ...(refresh ? { refresh: true } : {}) };
}

/** -> { v, verdict, summary, wins: [{ text, ref }], watchouts: [{ text, ref }], opportunities: [{ id, explanation, howTo }], questions, generatedAt, model, cached } */
export async function fetchNarrative({ aggregates, language, refresh, getToken, fetchImpl }) {
    const json = await postAi(INSIGHTS_ENDPOINT, buildInsightsRequest({ aggregates, language, refresh }), { getToken, fetchImpl });
    if (typeof json.verdict !== 'string' && typeof json.headline !== 'string' && !Array.isArray(json.opportunities)) {
        const { AiError } = await import('./aiCategorize');
        throw new AiError('server', 502);
    }
    return normalizeNarrative(json);
}

/** One shape for the screen whatever the answer's age: a summary saved before v2 (headline, concerns as strings) still reads. */
export function normalizeNarrative(json = {}) {
    const notes = (list) => (Array.isArray(list) ? list : []).map((n) => (typeof n === 'string' ? { text: n, ref: null } : { text: String(n?.text || ''), ref: n?.ref || null })).filter((n) => n.text);
    return {
        ...json,
        v: json.v || 1,
        verdict: json.verdict || json.headline || null,
        summary: json.summary || null,
        wins: notes(json.wins),
        watchouts: notes(json.watchouts ?? json.concerns),
        opportunities: (Array.isArray(json.opportunities) ? json.opportunities : []).filter((o) => o && typeof o.id === 'string' && typeof o.explanation === 'string'),
        questions: Array.isArray(json.questions) ? json.questions.filter((q) => typeof q === 'string') : [],
        generalTips: Array.isArray(json.generalTips) ? json.generalTips.filter((g) => typeof g === 'string' && g.trim()).slice(0, 3) : [],
    };
}
