// Exchange rates (exchangerate-api.com free tier). Base amounts are computed at WRITE time (plan P4-T2), so the
// rate is cached per calendar day in localStorage: a transaction saved offline with no cached rate gets a null
// base amount, which `fillMissingBaseAmounts` (repo.js) recomputes at the next sync.
// The host must stay in the CSP connect-src of vercel.json.

const EXCHANGE_RATE_API = 'https://api.exchangerate-api.com/v4/latest/';
const KEY_PREFIX = 'wmw.fx.';
const FETCH_TIMEOUT_MS = 4000;

const KEEP_DAYS = 14;
const dayMinus = (day, n) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
};

const memory = new Map(); // `${day}:${from}` -> rates object (works when localStorage is blocked)

export const todayKey = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

function readDay(from, day) {
    const k = `${day}:${from}`;
    if (memory.has(k)) return memory.get(k);
    try {
        const raw = localStorage.getItem(`${KEY_PREFIX}${day}.${from}`);
        if (raw) {
            const rates = JSON.parse(raw);
            memory.set(k, rates);
            return rates;
        }
    } catch {
        /* storage blocked or corrupt: treated as a cache miss */
    }
    return null;
}

function writeDay(from, day, rates) {
    memory.set(`${day}:${from}`, rates);
    try {
        // keep the last two weeks of tables: offline, the newest cached one is used (and labelled with its date)
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            const d = key && key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length, KEY_PREFIX.length + 10) : null;
            if (d && d < dayMinus(day, KEEP_DAYS)) localStorage.removeItem(key);
        }
        localStorage.setItem(`${KEY_PREFIX}${day}.${from}`, JSON.stringify(rates));
    } catch {
        /* quota or blocked: memory cache still works */
    }
}

/** Rate from the cache only (no network): number, 1 for the same currency, null when unknown. */
export function getCachedRate(from, to, day = todayKey()) {
    if (!from || !to) return null;
    if (from === to) return 1;
    const direct = readDay(from, day)?.[to];
    if (Number.isFinite(direct)) return direct;
    const inverse = readDay(to, day)?.[from];
    return Number.isFinite(inverse) && inverse > 0 ? 1 / inverse : null;
}

/** Newest cached table (any day within the last two weeks) that has the pair: { rate, date } or null. Used offline. */
export function getLatestCachedRate(from, to, today = todayKey()) {
    if (!from || !to || from === to) return null;
    const days = new Set();
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(KEY_PREFIX)) days.add(key.slice(KEY_PREFIX.length, KEY_PREFIX.length + 10));
        }
    } catch {
        /* storage blocked */
    }
    for (const k of memory.keys()) days.add(k.slice(0, 10));
    for (const day of [...days].sort().reverse()) {
        if (day > today || day < dayMinus(today, KEEP_DAYS)) continue;
        const rate = getCachedRate(from, to, day);
        if (rate !== null) return { rate, date: day };
    }
    return null;
}

/**
 * Rate with where it came from: { rate, date, source: 'same' | 'cache' | 'api' | 'cache-old' } or null (offline and nothing cached:
 * the caller stores the amount as pending, never 1:1). The free API only serves today's table, so `date` is the table's day, not
 * necessarily the purchase day.
 */
export async function getRateInfo(from, to, { day = todayKey(), fetchImpl } = {}) {
    if (!from || !to) return null;
    if (from === to) return { rate: 1, date: day, source: 'same' };
    const cached = getCachedRate(from, to, day);
    if (cached !== null) return { rate: cached, date: day, source: 'cache' };
    const live = await getRate(from, to, { day, ...(fetchImpl ? { fetchImpl } : {}) });
    if (live !== null) return { rate: live, date: day, source: 'api' };
    const old = getLatestCachedRate(from, to, day);
    return old ? { ...old, source: 'cache-old' } : null;
}

/**
 * Rate for 1 `from` in `to`: cache first, then one request (4 s timeout). null when offline or on any failure.
 * The free API only serves today's table, so a back-dated transaction uses today's rate.
 */
export async function getRate(from, to, { day = todayKey(), fetchImpl = (...a) => fetch(...a) } = {}) {
    const cached = getCachedRate(from, to, day);
    if (cached !== null) return cached;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
    try {
        const res = await fetchImpl(`${EXCHANGE_RATE_API}${encodeURIComponent(from)}`, { signal: controller?.signal });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.rates || typeof data.rates !== 'object') return null;
        writeDay(from, day, data.rates);
        const rate = data.rates[to];
        return Number.isFinite(rate) ? rate : null;
    } catch {
        return null; // offline, blocked by CSP, timeout...: the caller stores null and retries at the next sync
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Test helper: forget the in-memory cache. */
export function __clearRateCache() {
    memory.clear();
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith(KEY_PREFIX)) localStorage.removeItem(key);
        }
    } catch {
        /* ignore */
    }
}

// Kept for callers of the previous API (falls back to 1, i.e. no conversion, when no rate is known).
export const exchangeRateService = {
    async getExchangeRate(from, to) {
        return (await getRate(from, to)) ?? 1;
    },
    async convertAmount(amount, from, to) {
        return amount * (await this.getExchangeRate(from, to));
    },
    clearCache: __clearRateCache,
};
