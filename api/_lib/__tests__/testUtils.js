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
