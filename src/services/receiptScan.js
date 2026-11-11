/**
 * Receipt scan logic (no React): request to /api/extract-receipt, response validation, error
 * classification, hints, and the scan-flow state machine.
 *
 * Response (wrapped plan P2-T3 schema): { receipt: { merchant, merchantRaw, date, time, total, currency,
 * paymentMethod, category, items[{ name, quantity, unitPrice, price, category }], tax, confidence{...}, notes },
 * extraction: { provider, model, confidence?, rawText?, durationMs? } }
 */
import { AiBlockedError, post } from './aiOutbound';
import { getScanPrefs } from '../utils/scanPrefs';
export const EXTRACT_ENDPOINT = '/api/extract-receipt';
export const LOW_CONFIDENCE = 0.7;
const TIMEOUT_MS = 45000;

/** Error kinds the UI knows plain-language messages for. */
export const ERROR_KINDS = ['photosOff', 'offline', 'rateLimit', 'server', 'unavailable', 'auth', 'invalid', 'network'];

export class ScanError extends Error {
    constructor(kind, message, status) {
        super(message || kind);
        this.kind = kind;
        this.status = status;
    }
}

export const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
    });

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Build the extraction hints from what the app already knows about the user. */
export function buildHints({ languageCode = 'en', defaultCurrency = 'EUR', categories = [], transactions = [], accounts = [] }) {
    const counts = new Map();
    for (const tx of transactions) {
        const name = String(tx.merchant || '').trim();
        if (!name || tx.isDemo || tx.extraction?.pending) continue;
        const key = name.toLowerCase();
        const cur = counts.get(key) || { name, n: 0 };
        cur.n += 1;
        counts.set(key, cur);
    }
    const knownMerchants = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 50).map((m) => m.name);
    return {
        language: languageCode,
        defaultCurrency,
        categories: categories.filter((c) => c !== 'Income' && c !== 'Transfer'),
        knownMerchants,
        accounts: accounts.map((a) => a.name),
    };
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const conf = (v) => {
    const n = num(v);
    return n === null ? null : Math.min(1, Math.max(0, n));
};

/** Validate and normalise the server response. Throws ScanError('invalid') when it is not usable. */
export function parseExtractResponse(json) {
    const r = json?.receipt;
    if (!r || typeof r !== 'object') throw new ScanError('invalid', 'Response has no receipt');
    const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : null;
    const items = (Array.isArray(r.items) ? r.items : [])
        .map((it) => ({
            rawText: str(it?.rawText),
            name: str(it?.name) || '',
            quantity: num(it?.quantity) ?? 1,
            unit: str(it?.unit),
            packSize: str(it?.packSize),
            unitPrice: num(it?.unitPrice),
            price: num(it?.price),
            discount: num(it?.discount),
            taxRate: num(it?.taxRate),
            category: str(it?.category),
            subcategory: str(it?.subcategory),
        }))
        .filter((it) => it.name || it.price !== null);
    const extraction = json.extraction && typeof json.extraction === 'object' ? json.extraction : {};
    const c = { ...(r.confidence || {}), ...(extraction.confidence || {}) };
    return {
        receipt: {
            merchant: str(r.merchant),
            merchantRaw: str(r.merchantRaw),
            date,
            time: str(r.time),
            total: num(r.total),
            currency: str(r.currency),
            paymentMethod: ['card', 'cash'].includes(r.paymentMethod) ? r.paymentMethod : 'unknown',
            category: str(r.category),
            items,
            tax: num(r.tax),
            notes: str(r.notes),
            confidence: { merchant: conf(c.merchant), date: conf(c.date), total: conf(c.total), items: conf(c.items) },
        },
        extraction: { ...extraction, confidence: undefined },
    };
}

/** Fields whose confidence is below the threshold (null confidence = unknown = not flagged unless value is missing). */
export function lowConfidenceFields(receipt) {
    const c = receipt.confidence || {};
    const low = {};
    for (const f of ['merchant', 'date', 'total']) {
        const missing = f === 'total' ? receipt.total === null : !receipt[f];
        low[f] = missing || (c[f] !== null && c[f] !== undefined && c[f] < LOW_CONFIDENCE);
    }
    return low;
}

export const itemsSum = (items) => Math.round(items.reduce((s, it) => s + (it.price || 0), 0) * 100) / 100; // `price` is the line total

/** An item line that could not be read (no name, or no price). */
export const isUnreadable = (it) => !String(it.name || '').trim() || it.price === null || it.price === undefined || it.price === '';

/**
 * POST the prepared image. `getToken` returns the Supabase access token. Resolves to the parsed response or
 * throws ScanError(kind).
 */
export async function extractReceipt({ file, mime, hints, getToken, fetchImpl, signal }) {
    if (!getScanPrefs().sendPhotos) throw new ScanError('photosOff', 'Photos are not sent to the AI provider');
    if (isOffline()) throw new ScanError('offline', 'offline');
    const token = await getToken?.();
    if (!token) throw new ScanError('auth', 'Not signed in', 401);
    const body = { file: await fileToBase64(file), mime: mime || file.type || 'image/jpeg', hints };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    signal?.addEventListener?.('abort', () => controller.abort());
    let res;
    try {
        res = await post(EXTRACT_ENDPOINT, body, { token, fetchImpl, signal: controller.signal });
    } catch (err) {
        if (err instanceof AiBlockedError) throw new ScanError('photosOff', 'Photos are not sent to the AI provider');
        if (isOffline()) throw new ScanError('offline', 'offline');
        throw new ScanError('network', err?.message || 'network');
    } finally {
        clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new ScanError('auth', 'Unauthorized', res.status);
    if (res.status === 429) throw new ScanError('rateLimit', 'Rate limited', 429);
    if (res.status === 404 || res.status === 405) throw new ScanError('unavailable', 'Endpoint not available', res.status);
    if (res.status === 400 || res.status === 413 || res.status === 415 || res.status === 422) throw new ScanError('invalid', 'Rejected', res.status);
    if (res.status >= 500) throw new ScanError('server', 'Server error', res.status);
    if (!res.ok) throw new ScanError('server', `HTTP ${res.status}`, res.status);
    let json;
    try {
        json = await res.json();
    } catch {
        throw new ScanError('invalid', 'Response is not JSON', res.status);
    }
    return parseExtractResponse(json);
}

/** Errors worth retrying later without user action (used by the pending-scan processor). */
export const isRetryable = (err) => ['offline', 'network', 'server', 'rateLimit', 'unavailable'].includes(err?.kind);

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
export const initialScanState = { phase: 'idle', file: null, original: null, result: null, error: null, queued: false };

/**
 * phases: idle -> preparing -> [crop] -> extracting -> review | error | queued
 * events: PICK(file) PREPARED(file, crop?) CROPPED(file) EXTRACTED(result) FAILED(kind) QUEUED RESCAN RESTORE(file, result?)
 */
export function scanReducer(state, event) {
    switch (event.type) {
        case 'PICK':
            return { ...initialScanState, phase: 'preparing', original: event.file };
        case 'PREPARED':
            if (state.phase !== 'preparing') return state;
            return { ...state, phase: event.crop ? 'crop' : 'extracting', file: event.file }; // crop: the owner asked to trim the photo before it is sent
        case 'CROPPED':
            if (state.phase !== 'crop') return state;
            return { ...state, phase: 'extracting', file: event.file };
        case 'EXTRACTED':
            if (state.phase !== 'extracting') return state;
            return { ...state, phase: 'review', result: event.result, error: null };
        case 'FAILED':
            if (state.phase !== 'extracting' && state.phase !== 'preparing') return state;
            return { ...state, phase: 'error', error: event.kind };
        case 'QUEUED':
            return { ...state, phase: 'queued', error: null };
        case 'RESTORE': // a saved scan draft: back to review with its result, or to extraction when it never got that far
            return event.result ? { ...initialScanState, phase: 'review', file: event.file, result: event.result } : { ...initialScanState, phase: 'extracting', file: event.file };
        case 'RETRY':
            return state.file ? { ...state, phase: 'extracting', error: null } : state;
        case 'RESCAN':
            return { ...initialScanState };
        default:
            return state;
    }
}
