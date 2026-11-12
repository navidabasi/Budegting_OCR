// AI access (supabase/migrations/20261112_v16_ai_access.sql). The owner approves which accounts may use the AI features;
// the server enforces it (api/_lib/ratelimit.js). Here: read the signed-in account's status, and for the admin the list of
// accounts with today's AI calls, and the approve / deny call. Reads go through RLS; the decision through ai_access_decide().
import { supabase as defaultClient } from './supabaseService';

export const STATUSES = ['pending', 'approved', 'denied'];

/**
 * -> { status: 'pending' | 'approved' | 'denied', isAdmin } or null when it cannot be known (no backend, offline, table missing).
 * An account without a row is pending: it was created before the trigger ran or the trigger failed.
 */
export async function fetchAiAccess(userId, client = defaultClient) {
    if (!client || !userId) return null;
    const { data, error } = await client.from('ai_access').select('status, is_admin').eq('user_id', userId).maybeSingle();
    if (error) return null;
    if (!data) return { status: 'pending', isAdmin: false };
    return { status: STATUSES.includes(data.status) ? data.status : 'pending', isAdmin: !!data.is_admin };
}

/** What the app should do: unknown is allowed (the server still decides), otherwise approved or admin. */
export function accessView(row) {
    if (!row) return { status: 'unknown', isAdmin: false, allowed: true, known: false };
    const status = row.isAdmin ? 'approved' : row.status;
    return { status, isAdmin: row.isAdmin, allowed: status === 'approved', known: true };
}

/** Admin: every account with its status and today's AI calls, pending first, newest first. */
export async function fetchAccessList(client = defaultClient, now = new Date()) {
    if (!client) return [];
    const day = now.toISOString().slice(0, 10);
    const [{ data: rows, error }, { data: usage }] = await Promise.all([
        client.from('ai_access').select('user_id, email, status, is_admin, requested_at, decided_at').order('requested_at', { ascending: false }),
        client.from('ai_usage').select('user_id, calls').eq('day', day),
    ]);
    if (error) throw error;
    const today = new Map();
    for (const u of usage || []) today.set(u.user_id, (today.get(u.user_id) || 0) + (Number(u.calls) || 0));
    const rank = { pending: 0, approved: 1, denied: 2 };
    return (rows || [])
        .map((r) => ({ userId: r.user_id, email: r.email || '', status: r.status, isAdmin: !!r.is_admin, requestedAt: r.requested_at, decidedAt: r.decided_at, callsToday: today.get(r.user_id) || 0 }))
        .sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || rank[a.status] - rank[b.status] || String(b.requestedAt).localeCompare(String(a.requestedAt)));
}

/** Admin: approve, deny or reset an account. */
export async function decideAccess(userId, status, client = defaultClient) {
    if (!STATUSES.includes(status)) throw new Error('bad status');
    const { error } = await client.rpc('ai_access_decide', { p_user: userId, p_status: status });
    if (error) throw error;
}
