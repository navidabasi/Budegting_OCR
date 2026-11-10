// Shared helpers for the CSV parsers: hashing, number and date parsing, header matching.

// ---- SHA-1 ------------------------------------------------------------------------------
function sha1Fallback(message) {
    const bytes = new TextEncoder().encode(message);
    const words = [];
    for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    const bitLen = bytes.length * 8;
    words[bitLen >> 5] |= 0x80 << (24 - (bitLen % 32));
    words[(((bitLen + 64) >> 9) << 4) + 15] = bitLen;

    const rotl = (n, s) => (n << s) | (n >>> (32 - s));
    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;
    const w = new Array(80);
    for (let i = 0; i < words.length; i += 16) {
        for (let t = 0; t < 80; t++) {
            w[t] = t < 16 ? words[i + t] | 0 : rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
        }
        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        for (let t = 0; t < 80; t++) {
            let f;
            let k;
            if (t < 20) {
                f = (b & c) | (~b & d);
                k = 0x5a827999;
            } else if (t < 40) {
                f = b ^ c ^ d;
                k = 0x6ed9eba1;
            } else if (t < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8f1bbcdc;
            } else {
                f = b ^ c ^ d;
                k = 0xca62c1d6;
            }
            const temp = (rotl(a, 5) + f + e + k + w[t]) | 0;
            e = d;
            d = c;
            c = rotl(b, 30);
            b = a;
            a = temp;
        }
        h0 = (h0 + a) | 0;
        h1 = (h1 + b) | 0;
        h2 = (h2 + c) | 0;
        h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

/** SHA-1 hex via crypto.subtle when available (browser, Node 19+), pure-JS fallback otherwise. */
export async function sha1Hex(message) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle && typeof subtle.digest === 'function') {
        try {
            const digest = await subtle.digest('SHA-1', new TextEncoder().encode(message));
            return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        } catch {
            /* fall through */
        }
    }
    return sha1Fallback(message);
}

/**
 * Builds stable import refs: provider:sha1(normalised row). Identical rows inside one file get an
 * occurrence suffix so two identical coffees stay distinct, yet re-importing the file yields the same refs.
 */
export function createRefBuilder(provider) {
    const seen = new Map();
    return async (cells) => {
        const normalised = cells.map((c) => String(c ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
        const n = seen.get(normalised) || 0;
        seen.set(normalised, n + 1);
        return `${provider}:${await sha1Hex(n === 0 ? normalised : `${normalised}#${n}`)}`;
    };
}

// ---- numbers ----------------------------------------------------------------------------
/**
 * Parse an amount. decimal: ',' (Italian 1.234,56), '.' (US 1,234.56) or 'auto'.
 * Handles currency symbols, spaces, leading/trailing minus and (parentheses). Returns null if unparseable.
 */
export function parseAmount(value, decimal = 'auto') {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined) return null;
    let s = String(value).trim();
    if (!s) return null;
    let negative = false;
    if (/^\(.*\)$/.test(s)) {
        negative = true;
        s = s.slice(1, -1);
    }
    if (/-\s*$/.test(s)) {
        negative = true;
        s = s.replace(/-\s*$/, '');
    }
    if (/^\s*-/.test(s)) {
        negative = !negative;
        s = s.replace(/^\s*-/, '');
    }
    s = s.replace(/^\s*\+/, '').replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return null;

    let dec = decimal;
    if (dec === 'auto') {
        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        if (lastComma > -1 && lastDot > -1) dec = lastComma > lastDot ? ',' : '.';
        else if (lastComma > -1) dec = /,\d{3}$/.test(s) && s.split(',').length > 2 ? '.' : ',';
        else if (lastDot > -1) dec = /^\d{1,3}(\.\d{3})+$/.test(s) ? ',' : '.';
        else dec = '.';
    }
    s = dec === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const n = Number.parseFloat(s);
    if (!Number.isFinite(n)) return null;
    return negative ? -n : n;
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---- dates ------------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const valid = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * Parse to 'YYYY-MM-DD'. format: 'dmy' (31/12/2026, 31-12-2026, 31.12.26), 'mdy', 'ymd' (2026-12-31) or 'auto'
 * (ymd when it starts with 4 digits, otherwise dmy). Any time part is ignored. Returns null if invalid.
 */
export function parseDateString(value, format = 'auto') {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    const s = String(value ?? '').trim();
    if (!s) return null;
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?![\d])/.exec(s);
    if (m && (format === 'auto' || format === 'ymd')) {
        const [y, mo, d] = [+m[1], +m[2], +m[3]];
        return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
    }
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?![\d])/.exec(s);
    if (m) {
        let [a, b, y] = [+m[1], +m[2], +m[3]];
        if (m[3].length === 2) y += 2000;
        const [d, mo] = format === 'mdy' ? [b, a] : [a, b];
        return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
    }
    return null;
}

// ---- headers ----------------------------------------------------------------------------
export const normHeader = (h) =>
    String(h ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

/** Index of the first header equal to any of `names` (normalised), in the order of `names`; -1 if none. */
export function findColumn(headers, names) {
    const norm = headers.map(normHeader);
    for (const name of names) {
        const i = norm.indexOf(normHeader(name));
        if (i !== -1) return i;
    }
    return -1;
}

export const cleanText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
