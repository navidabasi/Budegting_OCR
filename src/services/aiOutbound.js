// The single outbound boundary for every AI request (pass 2, section 7).
//
// Every call to /api/chat, /api/insights, /api/categorize and /api/extract-receipt goes through post() below, which
//   1. pseudonymises account, person and trip identifiers (stable aliases for the session, reversible only on this device),
//   2. removes names of people, card/account numbers, IBAN-like strings, emails, phone numbers, addresses, loyalty ids
//      and store numbers from merchants, items and hints, and drops notes and raw descriptions entirely,
//   3. rounds timestamps to dates,
//   4. removes metadata (EXIF, XMP, IPTC) from receipt photos and refuses to send photos when the owner switched that off,
//   5. remembers the exact payload sent per feature so Settings can show it ("See what's sent").
// Keys never appear here: the bearer token is the user's session token and is only put in the request header, never in the
// recorded payload. The provider keys live on the server.
import { getScanPrefs } from '../utils/scanPrefs';

export const REQUEST_TIMEOUT_MS = 60000;
export const FEATURES = { '/api/chat': 'chat', '/api/insights': 'insights', '/api/categorize': 'categorize', '/api/extract-receipt': 'extract' };
export const featureOf = (endpoint) => FEATURES[endpoint] || 'other';

export class AiBlockedError extends Error {
    constructor(reason) {
        super(reason);
        this.name = 'AiBlockedError';
        this.reason = reason; // 'photosOff'
    }
}

// ---------------------------------------------------------------------------
// Context (who the people and accounts are, so their names can be removed)
// ---------------------------------------------------------------------------
let context = { people: [], accounts: [], trips: [] };
/** Registered by the app shell: { people: [{id,name}], accounts: [{id,name,counterparty?}], trips: [{id,name,companions?}] }. */
export const setOutboundContext = (next) => {
    context = { people: next?.people || [], accounts: next?.accounts || [], trips: next?.trips || [] };
};

// ---------------------------------------------------------------------------
// Pseudonyms: stable per session, one alias per real id
// ---------------------------------------------------------------------------
const aliases = { account: new Map(), person: new Map(), trip: new Map() };
const LABEL = { account: 'Account', person: 'Person', trip: 'Trip' };
export function resetPseudonyms() {
    for (const m of Object.values(aliases)) m.clear();
}
/** Alias of an id: 'Account A', 'Person 1', 'Trip 1'. Null/empty ids stay null. */
export function pseudo(kind, id) {
    if (id === null || id === undefined || id === '') return null;
    const map = aliases[kind];
    const key = String(id);
    if (!map.has(key)) {
        const n = map.size;
        map.set(key, kind === 'account' ? `${LABEL[kind]} ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? Math.floor(n / 26) : ''}` : `${LABEL[kind]} ${n + 1}`);
    }
    return map.get(key);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The names this device knows belong to people (people list, trip companions, debt/receivable counterparties, account holders). */
function knownPersonNames(ctx = context) {
    const out = new Map(); // lower name -> alias
    const add = (name, alias) => {
        const n = String(name || '').trim();
        if (n.length >= 2 && !out.has(n.toLowerCase())) out.set(n.toLowerCase(), alias);
    };
    for (const p of ctx.people || []) add(p.name, pseudo('person', p.id));
    for (const a of ctx.accounts || []) if (a.counterparty) add(a.counterparty, pseudo('person', `cp:${a.counterparty.toLowerCase()}`));
    for (const t of ctx.trips || []) for (const c of t.companions || []) add(typeof c === 'string' ? c : c?.name, pseudo('person', `cp:${String(typeof c === 'string' ? c : c?.name).toLowerCase()}`));
    return out;
}

/** Put the real names back into a text coming from the model (it only ever saw aliases). Local only. */
export function restoreAliases(text, ctx = context) {
    let out = String(text ?? '');
    const pairs = [];
    for (const p of ctx.people || []) pairs.push([pseudo('person', p.id), p.name]);
    for (const a of ctx.accounts || []) {
        pairs.push([pseudo('account', a.id), a.name]);
        if (a.counterparty) pairs.push([pseudo('person', `cp:${a.counterparty.toLowerCase()}`), a.counterparty]);
    }
    for (const t of ctx.trips || []) {
        pairs.push([pseudo('trip', t.id), t.name]);
        for (const c of t.companions || []) {
            const n = typeof c === 'string' ? c : c?.name;
            if (n) pairs.push([pseudo('person', `cp:${n.toLowerCase()}`), n]);
        }
    }
    for (const [alias, real] of pairs.sort((a, b) => b[0].length - a[0].length)) if (alias && real) out = out.replace(new RegExp(`\\b${escapeRe(alias)}\\b`, 'g'), real);
    return out;
}

// ---------------------------------------------------------------------------
// Text scrubbing
// ---------------------------------------------------------------------------
const hasDigit = (s) => /\d/.test(s);
const digitsOf = (s) => (s.match(/\d/g) || []).length;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{3,4}){3,8}\b/gi;
const MASKED_CARD = /(?:[*•xX]{2,}[ -]?|ending(?: in)?\s+|finale\s+)\d{4}\b/gi;
const PHONE = /(?:\+|\b00)\d{1,3}[\s.()-]*\d(?:[\s.()-]*\d){6,12}\b|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{3,4}\b/g;
const LONG_DIGITS = /\b\d(?:[ -]?\d){8,}\b/g; // 9+ digits, even grouped: card, account, phone, tax id
const LOYALTY = /(?:\b(?:card|carta|tessera|fidelity|loyalty|member(?:ship)?|socio|cliente|customer|codice|code|ref|rif|n°|nr|id|no)\b[\s:.#°-]*)+(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,}/gi;
const STORE_NO = /(?:#\s*\d+|\b(?:store|shop|filiale|negozio|pv|pdv|branch|sede|nr|n°)\s*\.?\s*\d+)/gi;
const STREET_WORDS = '(?:via|viale|corso|piazza|piazzale|largo|vicolo|strada|rue|avenue|ave|street|st|road|rd|lane|calle|carrer|platz|strasse|straße|str|boulevard|blvd|v\\.le|p\\.zza)';
const ADDRESS_A = new RegExp(`\\b${STREET_WORDS}\\.?\\s+(?:[^\\d,;\\n]{2,40}?)[\\s,]*\\d{1,4}[A-Za-z]?\\b`, 'gi'); // Via Roma 12
const ADDRESS_B = /\b\d{1,4}[A-Za-z]?\s+(?:[A-Za-z]+\s+){1,2}(?:street|st|road|rd|avenue|ave|lane|boulevard|blvd)\b\.?/gi; // 12 Main Street
const POSTCODE = /(?:,\s*|\b)\d{5}\s+[A-ZÀ-Ý][\p{L}]+/gu; // 10100 Torino
const P2P = /\b(settlement (?:to|from)|payment (?:to|from)|transfer (?:to|from)|sent to|received from|bonifico (?:a|da)|rimborso (?:a|da)|pagamento (?:a|da)|zahlung (?:an|von)|pago (?:a|de)|virement (?:à|de))\s+(?:[A-ZÀ-Ý][\p{L}'’-]+(?:\s+[A-ZÀ-Ý][\p{L}'’-]+){0,2})/giu;

function scrubIban(s) {
    return s.replace(IBAN, (m) => (m.replace(/[ -]/g, '').length >= 15 && hasDigit(m) ? '' : m));
}

/** Remove identifiers from a free-text string (merchant, item name, hint). Never throws; empty string when nothing is left. */
export function scrubText(value, ctx = context) {
    if (value === null || value === undefined) return '';
    let s = String(value);
    s = s.replace(EMAIL, ' ');
    s = scrubIban(s);
    s = s.replace(MASKED_CARD, ' ');
    s = s.replace(PHONE, ' ');
    s = s.replace(LONG_DIGITS, ' ');
    s = s.replace(LOYALTY, ' ');
    s = s.replace(ADDRESS_A, ' ').replace(ADDRESS_B, ' ');
    s = s.replace(POSTCODE, ' ');
    s = s.replace(STORE_NO, ' ');
    s = s.replace(P2P, (_m, prefix) => `${prefix} [person]`);
    for (const [name, alias] of knownPersonNames(ctx)) s = s.replace(new RegExp(`(^|[^\\p{L}])${escapeRe(name)}(?=$|[^\\p{L}])`, 'giu'), (_m, pre) => `${pre}${alias}`);
    // Tokens that are mostly digits and long are identifiers (loyalty numbers, terminal ids)
    s = s
        .split(/\s+/)
        .filter((tok) => !(tok.length >= 8 && digitsOf(tok) >= 5 && /^[A-Z0-9*/_-]+$/i.test(tok)))
        .join(' ');
    return s.replace(/\s{2,}/g, ' ').replace(/^[\s,;:/*-]+|[\s,;:/*-]+$/g, '').trim();
}

// ---------------------------------------------------------------------------
// Payload sanitising
// ---------------------------------------------------------------------------
const DROP_KEYS = new Set([
    'notes', 'note', 'memo', 'rawText', 'rawDescription', 'merchantRaw', 'userId', 'user_id', 'email', 'token', 'password', 'apiKey', 'api_key', 'address', 'location', 'lat', 'lng', 'latitude', 'longitude',
    'iban', 'accountNumber', 'cardNumber', 'cardLast4', 'phone', 'loyaltyId', 'memberId', 'branch', 'store', 'storeId', 'terminalId', 'time', 'imagePath', 'image', 'counterparty', 'holder',
]);
const ACCOUNT_KEYS = new Set(['accountId', 'toAccountId', 'fromAccountId']);
const PERSON_KEYS = new Set(['personId', 'payerId', 'payer', 'participantId']);
const TRIP_KEYS = new Set(['tripId', 'groupId']);
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
// Fields the app itself generates (protocol values, never user data): passed through untouched. Scrubbing them broke
// the /api/insights contract once: a hex `inputHash` looks like an identifier and was erased (400, no summary).
// pass 3: `oppKind` / `sourceKind` (the kind of a savings opportunity), `action` (the name of its button) and `ref` (N1 / O2 handles
// of findings and opportunities) are enums and handles the app makes up: no user data can be in them.
const PROTOCOL_KEYS = new Set(['inputHash', 'hash', 'sourceHash', 'version', 'intent', 'kind', 'basis', 'state', 'monthState', 'type', 'screen', 'role', 'oppKind', 'sourceKind', 'action', 'ref']);

export function sanitizeValue(value, ctx = context, key = '') {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
        if (key === 'accounts' && value.every((v) => typeof v === 'string')) return value.map((name) => accountAlias(name, ctx));
        if (key === 'companions') return [];
        return value.map((v) => sanitizeValue(v, ctx, key)).filter((v) => v !== '' && v !== undefined);
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (DROP_KEYS.has(k)) continue;
            if (ACCOUNT_KEYS.has(k)) out[k] = pseudo('account', v);
            else if (PERSON_KEYS.has(k)) out[k] = v === 'me' ? 'me' : pseudo('person', v);
            else if (TRIP_KEYS.has(k) && typeof v === 'string') out[k] = pseudo('trip', v);
            else out[k] = sanitizeValue(v, ctx, k);
        }
        return out;
    }
    if (typeof value === 'string') {
        if (PROTOCOL_KEYS.has(key) && /^[\w.:-]{1,80}$/.test(value)) return value;
        // assistant v2: an app-map route (`path` of an app_feature fact) is app documentation, never user data
        if (key === 'path' && /^\/[a-z0-9/?=&-]{0,60}$/.test(value)) return value;
        if (ISO_DATETIME.test(value)) return value.slice(0, 10);
        if (/^\d{4}-\d{2}(-\d{2})?$/.test(value) || key === 'language' || key === 'mime' || key === 'currency' || key === 'category' || key === 'subcategory') return value;
        return scrubText(value, ctx);
    }
    return value;
}

function accountAlias(name, ctx) {
    const hit = (ctx.accounts || []).find((a) => a.name === name);
    return hit ? pseudo('account', hit.id) : 'Account';
}

/** The body that actually leaves the device (without the photo bytes: those are handled by prepareImage). */
export function sanitizeBody(feature, body, ctx = context) {
    return sanitizeValue(body, ctx);
}

// ---------------------------------------------------------------------------
// Photos: metadata removal (byte level, lossless) and the setting
// ---------------------------------------------------------------------------
/** Remove EXIF/XMP/IPTC (JPEG APP1, APP13) and ancillary text/EXIF chunks (PNG). Other formats are returned untouched. */
export function stripImageMetadata(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8[0] === 0xff && u8[1] === 0xd8) return stripJpeg(u8);
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return stripPng(u8);
    return u8;
}

function stripJpeg(u8) {
    const chunks = [u8.subarray(0, 2)];
    let i = 2;
    while (i + 3 < u8.length) {
        if (u8[i] !== 0xff) break;
        const marker = u8[i + 1];
        if (marker === 0xff) {
            i += 1;
            continue;
        }
        if (marker === 0xda || marker === 0xd9) break; // start of scan: the rest is image data
        const len = (u8[i + 2] << 8) | u8[i + 3];
        const end = i + 2 + len;
        const isMeta = marker === 0xe1 || marker === 0xed || marker === 0xfe || (marker >= 0xe3 && marker <= 0xec); // EXIF/XMP, IPTC, comments, vendor APPn (ICC APP2 kept)
        if (!isMeta) chunks.push(u8.subarray(i, end));
        i = end;
    }
    chunks.push(u8.subarray(i));
    return concat(chunks);
}

function stripPng(u8) {
    const drop = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME', 'pHYs']);
    const chunks = [u8.subarray(0, 8)];
    let i = 8;
    while (i + 8 <= u8.length) {
        const len = ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]) >>> 0;
        const type = String.fromCharCode(u8[i + 4], u8[i + 5], u8[i + 6], u8[i + 7]);
        const end = i + 12 + len;
        if (!drop.has(type)) chunks.push(u8.subarray(i, end));
        i = end;
    }
    return concat(chunks);
}

function concat(parts) {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

const bytesToBase64 = (u8) => {
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
};
const base64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Base64 of a photo with its metadata removed. */
export const cleanBase64 = (b64) => bytesToBase64(stripImageMetadata(base64ToBytes(b64)));

// ---------------------------------------------------------------------------
// What was sent (the inspector reads this)
// ---------------------------------------------------------------------------
const STORE_KEY = 'wmw.aiOutbound';
const MAX_RECORD_CHARS = 60000;
const lastSent = new Map();

function persistLast() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(lastSent)));
    } catch {
        /* storage unavailable: the inspector shows this session only */
    }
}

export function recordOutbound(feature, endpoint, payload) {
    let text = JSON.stringify(payload, null, 2);
    const truncated = text.length > MAX_RECORD_CHARS;
    if (truncated) text = `${text.slice(0, MAX_RECORD_CHARS)}\n... (shortened here for display; the full payload was sent)`;
    lastSent.set(feature, { feature, endpoint, at: new Date().toISOString().slice(0, 16), text, truncated });
    persistLast();
}

/** { chat: { at, endpoint, text }, ... } the last payload sent per feature (this device). */
export function getLastOutbound() {
    const out = {};
    try {
        Object.assign(out, JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
    } catch {
        /* ignore */
    }
    for (const [k, v] of lastSent) out[k] = v;
    return out;
}

export function clearLastOutbound() {
    lastSent.clear();
    try {
        localStorage.removeItem(STORE_KEY);
    } catch {
        /* ignore */
    }
}

// ---------------------------------------------------------------------------
// The one place that talks to the AI endpoints
// ---------------------------------------------------------------------------
/**
 * post(endpoint, body, { token, fetchImpl, signal }) -> Response
 * Sanitises the body, records it for the inspector and sends it. Callers keep their own error mapping.
 */
export async function post(endpoint, body, { token, fetchImpl = (...a) => fetch(...a), signal } = {}) {
    const feature = featureOf(endpoint);
    let outgoing;
    let shown;
    if (feature === 'extract') {
        if (!getScanPrefs().sendPhotos) throw new AiBlockedError('photosOff');
        const { file, ...rest } = body || {};
        const clean = file ? cleanBase64(file) : file;
        const hints = sanitizeBody(feature, rest, context);
        outgoing = { ...hints, file: clean };
        shown = { ...hints, file: `[receipt photo, ${Math.round(((clean || '').length * 3) / 4 / 1024)} KB, metadata removed, not shown here]` };
    } else {
        outgoing = sanitizeBody(feature, body, context);
        shown = outgoing;
    }
    recordOutbound(feature, endpoint, shown);
    // A request that never answers must end in a retry state, not an endless spinner
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    signal?.addEventListener?.('abort', () => controller.abort());
    try {
        return await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(outgoing),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}
