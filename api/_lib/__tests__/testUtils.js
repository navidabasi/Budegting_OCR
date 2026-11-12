// Test helpers (not a test file): fake req/res and an in-memory Supabase-like client.

export function fakeReq({ method = 'POST', body = {}, headers = {} } = {}) {
    return { method, body, headers: { host: 'app.test', ...headers } };
}

export function fakeRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: undefined,
        setHeader(k, v) {
            this.headers[k.toLowerCase()] = v;
        },
        end(payload) {
            this.ended = true;
            if (payload) {
                try {
                    this.body = JSON.parse(payload);
                } catch {
                    this.body = payload;
                }
            }
        },
    };
    return res;
}

/**
 * Minimal in-memory stand-in for the parts of supabase-js we use:
 * from(t).select().eq()...[.maybeSingle()], from(t).upsert(row, { onConflict }).
 */
export function fakeSupabase(initial = {}) {
    const tables = {};
    for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));
    const table = (name) => (tables[name] ||= []);

    const client = {
        tables,
        // the v16 AI functions, as the database runs them for the signed-in user `uid` (default 'u1')
        uid: 'u1',
        async rpc(fn, args = {}) {
            const day = new Date().toISOString().slice(0, 10);
            const usage = table('ai_usage');
            if (fn === 'ai_consume') {
                const access = table('ai_access').find((r) => r.user_id === client.uid);
                if (!access?.is_admin && (access?.status || 'pending') !== 'approved') return { data: { allowed: false, reason: 'not_approved', status: access?.status || 'pending' }, error: null };
                const total = usage.filter((r) => r.user_id === client.uid && r.day === day).reduce((s, r) => s + r.calls, 0);
                if (total >= Math.max(args.p_limit || 1, 1)) return { data: { allowed: false, reason: 'limit', used: total, limit: args.p_limit }, error: null };
                const row = usage.find((r) => r.user_id === client.uid && r.day === day && r.kind === args.p_kind);
                if (row) row.calls += 1;
                else usage.push({ user_id: client.uid, day, kind: args.p_kind, calls: 1 });
                return { data: { allowed: true, used: total + 1, limit: args.p_limit }, error: null };
            }
            if (fn === 'ai_record_tokens') {
                const row = usage.find((r) => r.user_id === client.uid && r.day === day && r.kind === args.p_kind);
                if (row) Object.assign(row, { tokens_in: (row.tokens_in || 0) + args.p_in, tokens_out: (row.tokens_out || 0) + args.p_out });
                return { data: null, error: null };
            }
            return { data: null, error: { message: `unknown function ${fn}` } };
        },
        from(name) {
            return {
                select() {
                    const filters = [];
                    const run = () => table(name).filter((r) => filters.every(([k, v]) => r[k] === v));
                    const q = {
                        eq(k, v) {
                            filters.push([k, v]);
                            return q;
                        },
                        async maybeSingle() {
                            return { data: run()[0] ?? null, error: null };
                        },
                        then(resolve, reject) {
                            return Promise.resolve({ data: run(), error: null }).then(resolve, reject);
                        },
                    };
                    return q;
                },
                async upsert(row, { onConflict } = {}) {
                    const keys = (onConflict || 'id').split(',');
                    const rows = table(name);
                    const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
                    if (existing) Object.assign(existing, row);
                    else rows.push({ ...row });
                    return { error: null };
                },
            };
        },
    };
    return client;
}
