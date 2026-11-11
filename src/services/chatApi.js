// Client for POST /api/chat (plan P7-T1). Pure thread helpers + the request. The assistant never writes data:
// a suggestedAction only becomes a link to a prefilled screen (actionHref).
import { postAi } from './aiClient';

export const CHAT_ENDPOINT = '/api/chat';
export const MAX_TURNS = 10;
export const STORAGE_KEY = 'wmw-chat-thread';

/** Keep the last `max` messages; the conversation must start with a user message (the model API requires it). */
export function trimThread(messages = [], max = MAX_TURNS) {
    const out = messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).slice(-max);
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
}

/** The { role, content } pairs the endpoint accepts (error bubbles and actions stay client-side). */
export function toApiMessages(thread = []) {
    return trimThread(thread.filter((m) => !m.error)).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
}

export function loadThread(storage = typeof sessionStorage === 'undefined' ? null : sessionStorage) {
    try {
        const raw = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(raw) ? trimThread(raw.map((m) => ({ ...m }))) : [];
    } catch {
        return [];
    }
}

export function saveThread(thread, storage = typeof sessionStorage === 'undefined' ? null : sessionStorage) {
    try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(trimThread(thread.filter((m) => !m.error)).map(({ role, content, action }) => ({ role, content, ...(action ? { action } : {}) }))));
    } catch {
        /* storage unavailable: the thread just lives in memory */
    }
}

/** -> { answer, suggestedAction, model } */
export async function sendChat({ aggregates, thread, language = 'en', getToken, fetchImpl }) {
    const json = await postAi(CHAT_ENDPOINT, { aggregates, messages: toApiMessages(thread), language }, { getToken, fetchImpl });
    if (typeof json.answer !== 'string') {
        const { AiError } = await import('./aiCategorize');
        throw new AiError('server', 502);
    }
    return { answer: json.answer, suggestedAction: json.suggestedAction || null, model: json.model || null };
}

/** Route that opens the matching prefilled sheet / filtered screen for a suggestedAction, or null. */
export function actionHref(action, month) {
    if (!action || typeof action !== 'object') return null;
    const p = action.payload || {};
    const q = new URLSearchParams();
    if (action.type === 'set_budget') {
        if (month) q.set('m', month);
        q.set('budget', /^(total|whole month)$/i.test(p.category) ? '*' : p.category);
        q.set('amount', String(p.amount));
        return `/plan?${q.toString()}`;
    }
    if (action.type === 'add_goal') {
        q.set('tab', 'savings');
        q.set('goal', p.name);
        q.set('target', String(p.targetAmount));
        if (p.targetDate) q.set('date', p.targetDate);
        return `/plan?${q.toString()}`;
    }
    if (action.type === 'open_filter') {
        // An answer's link must show what the answer talks about. Without an explicit month the model is talking
        // about the history (averages, trends), so open all time rather than silently narrowing to the current period.
        const m = p.month || (p.screen === 'activity' || !p.screen ? 'all' : month);
        if (m) q.set('m', m);
        if (p.screen === 'budgets') return `/plan?${q.toString()}`;
        if (p.screen === 'savings') {
            q.set('tab', 'savings');
            return `/plan?${q.toString()}`;
        }
        if (p.category) q.set('cat', p.category);
        if (p.merchant) q.set('merchant', p.merchant);
        return `/activity?${q.toString()}`;
    }
    return null;
}
