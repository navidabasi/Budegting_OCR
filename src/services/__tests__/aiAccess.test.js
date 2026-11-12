import { describe, expect, it, vi } from 'vitest';
import { accessView, decideAccess, fetchAccessList, fetchAiAccess } from '../aiAccess';
import { postAi } from '../aiClient';

const client = (tables, rpc = vi.fn(async () => ({ error: null }))) => ({
    rpc,
    from: (name) => {
        const filters = [];
        const q = {
            select: () => q,
            eq: (k, v) => (filters.push([k, v]), q),
            order: () => q,
            maybeSingle: async () => ({ data: (tables[name] || []).filter((r) => filters.every(([k, v]) => r[k] === v))[0] ?? null, error: tables.error || null }),
            then: (res) => Promise.resolve({ data: (tables[name] || []).filter((r) => filters.every(([k, v]) => r[k] === v)), error: tables.error || null }).then(res),
        };
        return q;
    },
});

describe('AI access on the device', () => {
    it('reads the own status; no row is pending; an error is unknown (the server still decides)', async () => {
        expect(await fetchAiAccess('u1', client({ ai_access: [{ user_id: 'u1', status: 'approved', is_admin: false }] }))).toEqual({ status: 'approved', isAdmin: false });
        expect(await fetchAiAccess('u1', client({ ai_access: [] }))).toEqual({ status: 'pending', isAdmin: false });
        expect(await fetchAiAccess('u1', client({ error: { message: 'no table' } }))).toBeNull();
        expect(await fetchAiAccess('u1', null)).toBeNull();
    });

    it('only approved accounts and the admin are allowed; unknown stays allowed', () => {
        expect(accessView({ status: 'pending', isAdmin: false })).toMatchObject({ allowed: false, known: true, status: 'pending' });
        expect(accessView({ status: 'denied', isAdmin: false })).toMatchObject({ allowed: false });
        expect(accessView({ status: 'approved', isAdmin: false })).toMatchObject({ allowed: true });
        expect(accessView({ status: 'pending', isAdmin: true })).toMatchObject({ allowed: true, status: 'approved', isAdmin: true });
        expect(accessView(null)).toMatchObject({ allowed: true, known: false, status: 'unknown' });
    });

    it('the admin list puts the admin, then waiting accounts first, with today\'s calls', async () => {
        const now = new Date('2026-11-12T10:00:00Z');
        const list = await fetchAccessList(
            client({
                ai_access: [
                    { user_id: 'a', email: 'a@x', status: 'approved', requested_at: '2026-11-01' },
                    { user_id: 'me', email: 'me@x', status: 'approved', is_admin: true, requested_at: '2025-12-31' },
                    { user_id: 'b', email: 'b@x', status: 'pending', requested_at: '2026-11-11' },
                ],
                ai_usage: [{ user_id: 'a', day: '2026-11-12', calls: 3 }, { user_id: 'a', day: '2026-11-12', calls: 2 }],
            }),
            now
        );
        expect(list.map((r) => r.userId)).toEqual(['me', 'b', 'a']);
        expect(list.find((r) => r.userId === 'a').callsToday).toBe(5);
    });

    it('decide calls the database function and rejects bad statuses', async () => {
        const rpc = vi.fn(async () => ({ error: null }));
        await decideAccess('b', 'approved', client({}, rpc));
        expect(rpc).toHaveBeenCalledWith('ai_access_decide', { p_user: 'b', p_status: 'approved' });
        await expect(decideAccess('b', 'admin', client({}, rpc))).rejects.toThrow();
    });

    it('a 403 ai_not_approved from an AI endpoint is its own error kind', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ code: 'ai_not_approved' }) }));
        await expect(postAi('/api/chat', { messages: [] }, { getToken: async () => 't', fetchImpl })).rejects.toMatchObject({ kind: 'notApproved' });
        const other = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ code: 'forbidden' }) }));
        await expect(postAi('/api/chat', { messages: [] }, { getToken: async () => 't', fetchImpl: other })).rejects.toMatchObject({ kind: 'auth' });
    });
});
