// Shared POST helper for the AI endpoints that take a bearer token (insights, chat). Errors are AiError kinds:
// offline | auth | notApproved | notConfigured | rateLimit | invalid | server | network.
import { AiError } from './aiCategorize';
import { post } from './aiOutbound';

export async function postAi(endpoint, body, { getToken, fetchImpl } = {}) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AiError('offline');
    const token = await getToken?.();
    if (!token) throw new AiError('auth', 401);
    let res;
    try {
        res = await post(endpoint, body, { token, fetchImpl });
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
    // the owner has not approved AI features for this account (api/_lib/ratelimit.js)
    if (res.status === 403 && json?.code === 'ai_not_approved') throw new AiError('notApproved', 403);
    if (res.status === 401 || res.status === 403) throw new AiError('auth', res.status);
    if (res.status === 429) throw new AiError('rateLimit', 429);
    if (res.status === 400 || res.status === 413) throw new AiError('invalid', res.status);
    if (!res.ok || !json) throw new AiError('server', res.status);
    return json;
}
