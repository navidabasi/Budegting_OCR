// Client for POST /api/insights (plan P6-T3). The request carries aggregates only (insightsAggregates.js).
import { hashAggregates } from './insightsAggregates';
import { postAi } from './aiClient';

export const INSIGHTS_ENDPOINT = '/api/insights';

/** Body per api/insights.js: { aggregates, language, inputHash, refresh? }. inputHash is the clock-independent hash. */
export function buildInsightsRequest({ aggregates, language = 'en', refresh = false }) {
    return { aggregates, language, inputHash: hashAggregates(aggregates), ...(refresh ? { refresh: true } : {}) };
}

/** -> { headline, summary, wins, concerns, actions, questions, generatedAt, model, cached } */
export async function fetchNarrative({ aggregates, language, refresh, getToken, fetchImpl }) {
    const json = await postAi(INSIGHTS_ENDPOINT, buildInsightsRequest({ aggregates, language, refresh }), { getToken, fetchImpl });
    if (typeof json.headline !== 'string' || typeof json.summary !== 'string') {
        const { AiError } = await import('./aiCategorize');
        throw new AiError('server', 502);
    }
    return json;
}
