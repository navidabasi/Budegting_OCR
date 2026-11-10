// Per-user daily AI call cap, stored in ai_usage (user_id, day, kind, calls, tokens_in, tokens_out).
// Env: AI_DAILY_LIMIT_PER_USER (default 100). The cap is across all kinds for the UTC day.
import { HttpError } from './http.js';

export const DEFAULT_DAILY_LIMIT = 100;

export function getDailyLimit(env = process.env) {
    const n = Number.parseInt(env.AI_DAILY_LIMIT_PER_USER, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Count one AI call for `kind`. Throws HttpError(429) when the user already used the daily limit.
 * `client` must be a Supabase client authenticated as the user.
 */
export async function consume(client, userId, kind, { now = new Date(), limit = getDailyLimit() } = {}) {
    const day = todayUtc(now);
    const { data: rows, error } = await client
        .from('ai_usage')
        .select('kind, calls')
        .eq('user_id', userId)
        .eq('day', day);
    if (error) throw new HttpError(500, 'Could not read AI usage', 'usage_read');

    const list = rows || [];
    const total = list.reduce((sum, r) => sum + (Number(r.calls) || 0), 0);
    if (total >= limit) {
        throw new HttpError(429, 'Daily AI limit reached. Try again tomorrow.', 'ai_limit');
    }
    const current = list.find((r) => r.kind === kind);
    const calls = (Number(current?.calls) || 0) + 1;
    const { error: upsertError } = await client
        .from('ai_usage')
        .upsert({ user_id: userId, day, kind, calls }, { onConflict: 'user_id,day,kind' });
    if (upsertError) throw new HttpError(500, 'Could not record AI usage', 'usage_write');
    return { used: total + 1, limit, remaining: limit - total - 1 };
}

/** Best-effort token accounting after a successful call. Never throws. */
export async function recordTokens(client, userId, kind, usage, { now = new Date() } = {}) {
    try {
        const day = todayUtc(now);
        const { data } = await client
            .from('ai_usage')
            .select('calls, tokens_in, tokens_out')
            .eq('user_id', userId)
            .eq('day', day)
            .eq('kind', kind)
            .maybeSingle();
        await client.from('ai_usage').upsert(
            {
                user_id: userId,
                day,
                kind,
                calls: Number(data?.calls) || 1,
                tokens_in: (Number(data?.tokens_in) || 0) + (usage?.promptTokens || 0),
                tokens_out: (Number(data?.tokens_out) || 0) + (usage?.completionTokens || 0),
            },
            { onConflict: 'user_id,day,kind' }
        );
    } catch {
        /* accounting only */
    }
}
