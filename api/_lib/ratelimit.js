// AI access and the per-user daily AI call cap (supabase/migrations/20261112_v16_ai_access.sql).
// Env: AI_DAILY_LIMIT_PER_USER (default 30). The cap is across all kinds for the UTC day.
//
// Both checks run in the database (ai_consume, security definer) as the calling user: the account must be approved by the
// owner (ai_access) and under today's cap; the call is counted in the same transaction. Users cannot write ai_usage
// directly, so the count cannot be reset from the browser.
import { HttpError } from './http.js';

export const DEFAULT_DAILY_LIMIT = 30;

export function getDailyLimit(env = process.env) {
    const n = Number.parseInt(env.AI_DAILY_LIMIT_PER_USER, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Count one AI call for `kind`. Throws HttpError 403 `ai_not_approved` when the owner has not approved the account,
 * 429 `ai_limit` when today's cap is used up. `client` must be a Supabase client authenticated as the user.
 */
export async function consume(client, userId, kind, { limit = getDailyLimit() } = {}) {
    void userId; // the database takes the user from the token (auth.uid())
    const { data, error } = await client.rpc('ai_consume', { p_kind: kind, p_limit: limit });
    if (error || !data) throw new HttpError(500, 'Could not check AI usage', 'usage_read');
    if (!data.allowed && data.reason === 'not_approved') {
        throw new HttpError(403, 'AI features are waiting for approval on this account.', 'ai_not_approved');
    }
    if (!data.allowed) throw new HttpError(429, 'Daily AI limit reached. Try again tomorrow.', 'ai_limit');
    return { used: data.used, limit, remaining: Math.max(0, limit - data.used) };
}

/** Best-effort token accounting after a successful call. Never throws. */
export async function recordTokens(client, userId, kind, usage) {
    void userId;
    try {
        await client.rpc('ai_record_tokens', { p_kind: kind, p_in: usage?.promptTokens || 0, p_out: usage?.completionTokens || 0 });
    } catch {
        /* accounting only */
    }
}
