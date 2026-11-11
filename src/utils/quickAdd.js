import { format, subDays } from 'date-fns';
import { addDays } from './monthMath';
import { todayInTimezone } from './payCycle';

let clockTimezone = null;
/** The user's timezone (settings): "today" for new entries is the date there. null = the device's own date. */
export const setClockTimezone = (tz) => {
    clockTimezone = tz || null;
};

const norm = (s) => String(s || '').trim().toLowerCase();

/** Merchants from the last `days` days, most frequent first (ties: most recent first). */
export function recentMerchants(transactions, { now = Date.now(), days = 90, limit = 5, type = 'expense' } = {}) {
    const since = format(subDays(new Date(now), days), 'yyyy-MM-dd');
    const map = new Map();
    for (const tx of transactions || []) {
        if (tx.isDemo || (tx.transactionType || 'expense') !== type) continue;
        const name = String(tx.merchant || '').trim();
        const date = String(tx.date || '').slice(0, 10);
        if (!name || date < since) continue;
        const key = norm(name);
        const cur = map.get(key) || { name, count: 0, last: '' };
        cur.count += 1;
        if (date >= cur.last) {
            cur.last = date;
            cur.name = name;
        }
        map.set(key, cur);
    }
    return [...map.values()]
        .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
        .slice(0, limit)
        .map((m) => m.name);
}

/** Category of the user's most recent transaction at the same merchant, or null. */
export function categoryForMerchant(transactions, merchant) {
    const key = norm(merchant);
    if (!key) return null;
    let best = null;
    for (const tx of transactions || []) {
        if (norm(tx.merchant) !== key || !tx.category || tx.isDemo) continue;
        if (!best || String(tx.date) >= String(best.date)) best = tx;
    }
    return best ? best.category : null;
}

/** Category names ordered: suggested first, then by how often the user picked them, then the rest. */
export function rankCategories({ suggested, transactions, names, limit = 4 }) {
    const counts = new Map();
    for (const tx of transactions || []) {
        if (tx.category && (tx.transactionType || 'expense') === 'expense') counts.set(tx.category, (counts.get(tx.category) || 0) + 1);
    }
    const byUse = [...names].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
    const ordered = [...new Set([suggested, ...byUse].filter((n) => n && names.includes(n)))];
    return { top: ordered.slice(0, limit), all: ordered };
}

const LAST_ACCOUNT_KEY = 'wmw.lastAccountId';

export function getLastAccountId() {
    try {
        return localStorage.getItem(LAST_ACCOUNT_KEY);
    } catch {
        return null;
    }
}

export function setLastAccountId(id) {
    try {
        if (id) localStorage.setItem(LAST_ACCOUNT_KEY, id);
    } catch {
        /* storage blocked: the default simply is not remembered */
    }
}

export const dateKey = (offsetDays = 0, now = new Date()) => (clockTimezone ? addDays(todayInTimezone(clockTimezone, now), -offsetDays) : format(subDays(now, offsetDays), 'yyyy-MM-dd'));
