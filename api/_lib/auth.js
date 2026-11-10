// Supabase JWT verification for serverless functions.
// Env: SUPABASE_URL (falls back to VITE_SUPABASE_URL), SUPABASE_ANON_KEY (falls back to VITE_SUPABASE_ANON_KEY).
import { createClient } from '@supabase/supabase-js';
import { HttpError } from './http.js';

const env = (name) => (process.env[name] || process.env[`VITE_${name}`] || '').trim();

export function getBearerToken(req) {
    const header = req.headers?.authorization || req.headers?.Authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
    return match ? match[1].trim() : '';
}

/**
 * Verify the caller. Returns { user, userId, token, client } where `client` is a Supabase
 * client acting as the user (RLS applies). Throws HttpError 401 when not authenticated.
 */
export async function requireUser(req, { createClientImpl = createClient } = {}) {
    const token = getBearerToken(req);
    if (!token) throw new HttpError(401, 'Missing bearer token', 'unauthorized');

    const url = env('SUPABASE_URL');
    const anonKey = env('SUPABASE_ANON_KEY');
    if (!url || !anonKey) throw new HttpError(500, 'Supabase is not configured on the server', 'supabase_not_configured');

    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const verifier = createClientImpl(url, anonKey, options);
    const { data, error } = await verifier.auth.getUser(token);
    if (error || !data?.user) throw new HttpError(401, 'Invalid or expired token', 'unauthorized');

    const client = createClientImpl(url, anonKey, {
        ...options,
        global: { headers: { Authorization: `Bearer ${token}` } },
    });
    return { user: data.user, userId: data.user.id, token, client };
}
