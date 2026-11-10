/**
 * "Categorise with AI" (plan P3-T4): uncategorised transactions -> unique merchantKeys (<= 50 per request)
 * -> POST /api/categorize -> review -> apply as a batch + rules with source 'llm'.
 * Pure helpers first, then the network call and the apply step.
 */
import { batchUpdateTransactions } from '../data/repo';
import { displayName } from '../utils/merchant';
import { upsertUserRule, keyOf } from './categoryLearning';
import { isUncategorised } from '../utils/activityFilters';

export const CATEGORIZE_ENDPOINT = '/api/categorize';
export const BATCH_SIZE = 50;
export const PRESELECT_CONFIDENCE = 0.8;

export class AiError extends Error {
    constructor(kind, status) {
        super(kind);
        this.kind = kind; // notConfigured | rateLimit | offline | auth | server | network | invalid
        this.status = status;
    }
}

/** Unique merchants of the uncategorised expenses: [{ key, name, description?, sampleItems, count, transactionIds }]. */
export function uncategorisedMerchants(transactions) {
    const byKey = new Map();
    for (const tx of transactions || []) {
        if (!tx || tx.isDemo || !isUncategorised(tx)) continue;
        const key = keyOf(tx);
        if (!key) continue;
        const entry = byKey.get(key) || { key, name: displayName(tx.merchant) || String(tx.merchant || key), description: null, sampleItems: [], count: 0, transactionIds: [] };
        const raw = String(tx.merchant || '').trim();
        if (!entry.description && raw && raw.toLowerCase() !== entry.name.toLowerCase()) entry.description = raw.slice(0, 240);
        for (const it of tx.lineItems || []) {
            const n = String(it?.name || '').trim();
            if (n && entry.sampleItems.length < 5 && !entry.sampleItems.includes(n)) entry.sampleItems.push(n.slice(0, 80));
        }
        entry.count += 1;
        entry.transactionIds.push(tx.id);
        byKey.set(key, entry);
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export const chunk = (list, size = BATCH_SIZE) => {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
};

const payloadOf = (m) => ({ key: m.key, name: m.name.slice(0, 160), ...(m.description ? { description: m.description } : {}), ...(m.sampleItems.length ? { sampleItems: m.sampleItems } : {}) });

async function postBatch(merchants, categories, { getToken, fetchImpl }) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AiError('offline');
    const token = await getToken?.();
    if (!token) throw new AiError('auth', 401);
    let res;
    try {
        res = await fetchImpl(CATEGORIZE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ merchants: merchants.map(payloadOf), categories }),
        });
    } catch {
        throw new AiError('network');
    }
    let json = null;
    try {
        json = await res.json();
    } catch {
        /* non-JSON error body */
    }
    if (res.status === 503 && json?.code === 'llm_not_configured') throw new AiError('notConfigured', 503);
    if (res.status === 401 || res.status === 403) throw new AiError('auth', res.status);
    if (res.status === 429) throw new AiError('rateLimit', 429);
    if (res.status === 400 || res.status === 413) throw new AiError('invalid', res.status);
    if (!res.ok || !Array.isArray(json?.results)) throw new AiError('server', res.status);
    return json.results;
}

/**
 * suggestions = await categorizeMerchants({ merchants, categories, getToken })
 * -> [{ ...merchant, category, confidence, selected }] (confidence >= 0.8 and not "Other" are preselected).
 * Batches run one after another; the first failure aborts (nothing partial is applied here).
 */
export async function categorizeMerchants({ merchants, categories, getToken, fetchImpl = (...a) => fetch(...a), onProgress }) {
    const out = [];
    const batches = chunk(merchants);
    for (let i = 0; i < batches.length; i++) {
        const results = await postBatch(batches[i], categories, { getToken, fetchImpl });
        const byKey = new Map(results.map((r) => [r.key, r]));
        for (const m of batches[i]) {
            const r = byKey.get(m.key);
            const category = r?.category && categories.includes(r.category) ? r.category : null;
            const confidence = Number.isFinite(r?.confidence) ? r.confidence : 0;
            out.push({ ...m, category, confidence, selected: !!category && category !== 'Other' && confidence >= PRESELECT_CONFIDENCE });
        }
        onProgress?.(i + 1, batches.length);
    }
    return out;
}

/**
 * Apply the accepted suggestions: every uncategorised transaction of each merchant gets the category in ONE batch,
 * and a rule with source 'llm' is stored per merchant (a user rule is never overwritten).
 * Returns { count, undo }.
 */
export async function applySuggestions(userId, suggestions) {
    const accepted = suggestions.filter((s) => s.selected && s.category);
    const changes = accepted.flatMap((s) => s.transactionIds.map((id) => ({ id, patch: { category: s.category } })));
    const previous = await batchUpdateTransactions(changes);
    for (const s of accepted) {
        try {
            await upsertUserRule(userId, s.key, s.category, s.name, { source: 'llm', bump: false });
        } catch (err) {
            console.warn('[categorise] could not save rule', err);
        }
    }
    return { count: previous.length, merchants: accepted.length, undo: () => batchUpdateTransactions(previous) };
}
