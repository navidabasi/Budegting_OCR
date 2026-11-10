// Shared HTTP helpers for Vercel Node functions (ESM, Node 18+).
// Underscore-prefixed folders are not deployed as routes.

export const MAX_BODY_BYTES = 12 * 1024 * 1024;

export class HttpError extends Error {
    constructor(status, message, code) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.code = code || undefined;
    }
}

/** Write a JSON response. Works with Vercel's res helpers and with plain node:http. */
export function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(payload));
}

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'];

const hostOf = (value) => {
    try {
        return new URL(value).host.toLowerCase();
    } catch {
        return '';
    }
};

/** Same-origin check. No Origin header (curl, server-to-server, same-origin GET) is allowed. */
export function isOriginAllowed(req) {
    const origin = (req.headers?.origin || '').trim().replace(/\/$/, '');
    if (!origin) return true;
    const requestHost = String(req.headers?.host || '').toLowerCase();
    if (requestHost && hostOf(origin) === requestHost) return true;
    const extra = [process.env.APP_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',')]
        .map((o) => (o || '').trim().replace(/\/$/, ''))
        .filter(Boolean);
    return DEV_ORIGINS.includes(origin) || extra.includes(origin);
}

/** Return the parsed JSON body, enforcing the size limit. */
export function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
    const declared = Number.parseInt(req.headers?.['content-length'], 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new HttpError(413, 'Request body too large', 'payload_too_large');
    }
    let body = req.body;
    if (body === undefined || body === null || body === '') return {};
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
        if (Buffer.byteLength(body) > maxBytes) {
            throw new HttpError(413, 'Request body too large', 'payload_too_large');
        }
        try {
            return JSON.parse(body);
        } catch {
            throw new HttpError(400, 'Invalid JSON body', 'invalid_json');
        }
    }
    if (typeof body === 'object') {
        // Vercel already parsed it; guard against huge payloads when no content-length is known.
        if (!Number.isFinite(declared) && JSON.stringify(body).length > maxBytes) {
            throw new HttpError(413, 'Request body too large', 'payload_too_large');
        }
        return body;
    }
    throw new HttpError(400, 'Invalid body', 'invalid_body');
}

/** Map any thrown error to { status, body }. */
export function errorToResponse(err) {
    if (err instanceof HttpError) {
        return { status: err.status, body: { error: err.message, code: err.code } };
    }
    switch (err?.name) {
        case 'NoVisionModelError':
            return { status: 503, body: { error: err.message, code: 'no_vision_model' } };
        case 'LlmError': {
            const status = err.code === 'timeout' ? 504 : 502;
            return { status, body: { error: 'AI provider error', code: err.code || 'llm_error' } };
        }
        case 'LlmConfigError':
            return { status: 503, body: { error: 'AI is not configured on the server', code: 'llm_not_configured' } };
        case 'ZodError':
            return {
                status: 400,
                body: { error: 'Invalid request', code: 'invalid_request', issues: err.issues?.slice(0, 10) },
            };
        default:
            console.error('[api] unexpected error:', err);
            return { status: 500, body: { error: 'Internal error', code: 'internal' } };
    }
}

/**
 * Wrap a handler body: OPTIONS/CORS, origin check, method check, JSON body parsing and
 * error mapping. `handle({ req, res, body })` returns the JSON payload (or undefined if it
 * wrote the response itself).
 */
export function route({ methods = ['POST'], handle, maxBytes = MAX_BODY_BYTES }) {
    return async function handler(req, res) {
        try {
            if (!isOriginAllowed(req)) throw new HttpError(403, 'Origin not allowed', 'origin');
            const origin = req.headers?.origin;
            if (origin) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Vary', 'Origin');
                res.setHeader('Access-Control-Allow-Methods', `${methods.join(', ')}, OPTIONS`);
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            }
            if (req.method === 'OPTIONS') {
                res.statusCode = 204;
                res.end();
                return;
            }
            if (!methods.includes(req.method)) {
                res.setHeader('Allow', methods.join(', '));
                throw new HttpError(405, 'Method not allowed', 'method');
            }
            const body = req.method === 'GET' ? {} : readJsonBody(req, maxBytes);
            const payload = await handle({ req, res, body });
            if (payload !== undefined) sendJson(res, 200, payload);
        } catch (err) {
            const { status, body } = errorToResponse(err);
            sendJson(res, status, body);
        }
    };
}
