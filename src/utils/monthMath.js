// Month-key helpers and "safe to spend". Pure; works on 'YYYY-MM' keys and 'YYYY-MM-DD' strings
// so there is no timezone drift. Date objects are read in local time (like the rest of the app).

const pad = (n) => String(n).padStart(2, '0');

/** Normalise 'YYYY-MM-DD[T..]' | Date | { year, month } to { y, m, d } (m 1-12) or null. */
export function toYmd(value) {
    if (!value) return null;
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
    }
    if (typeof value === 'string') {
        const full = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
        if (full) return { y: +full[1], m: +full[2], d: +full[3] };
        const month = /^(\d{4})-(\d{2})$/.exec(value);
        if (month) return { y: +month[1], m: +month[2], d: 1 };
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : toYmd(parsed);
    }
    return null;
}

/** 'YYYY-MM' for a date value (empty string when invalid). */
export function monthKey(value) {
    const p = toYmd(value);
    return p ? `${p.y}-${pad(p.m)}` : '';
}

/** 'YYYY-MM-DD' for a date value (empty string when invalid). */
export function dateKey(value) {
    const p = toYmd(value);
    return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : '';
}

export function daysInMonth(month) {
    const p = toYmd(month);
    if (!p) return 0;
    return new Date(p.y, p.m, 0).getDate();
}

/** First day 'YYYY-MM-01'. */
export function monthStart(month) {
    const p = toYmd(month);
    return p ? `${p.y}-${pad(p.m)}-01` : '';
}

/** Last day 'YYYY-MM-DD'. */
export function monthEnd(month) {
    const p = toYmd(month);
    return p ? `${p.y}-${pad(p.m)}-${pad(daysInMonth(month))}` : '';
}

export function addMonths(month, n) {
    const p = toYmd(month);
    if (!p) return '';
    const idx = p.y * 12 + (p.m - 1) + n;
    return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** The `n` months before `month`, oldest first: previousMonths('2026-11', 3) -> ['2026-08','2026-09','2026-10']. */
export function previousMonths(month, n = 3) {
    return Array.from({ length: n }, (_, i) => addMonths(month, i - n));
}

/** Months from `a` to `b` (b - a). */
export function monthsBetween(a, b) {
    const pa = toYmd(a);
    const pb = toYmd(b);
    if (!pa || !pb) return 0;
    return (pb.y - pa.y) * 12 + (pb.m - pa.m);
}

/** Whole days from date a to date b (b - a), DST safe. */
export function daysBetween(a, b) {
    const pa = toYmd(a);
    const pb = toYmd(b);
    if (!pa || !pb) return 0;
    return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function addDays(value, n) {
    const p = toYmd(value);
    if (!p) return '';
    const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Where "today" sits inside `month`: { day, days, daysLeft, pct, state }.
 * A past month is fully elapsed (day = days, daysLeft = 0); a future month has not started (day = 0).
 * daysLeft includes today.
 */
export function monthProgress(month, today = new Date()) {
    const days = daysInMonth(month);
    const diff = monthsBetween(month, today);
    let day;
    let state;
    if (diff > 0) {
        day = days;
        state = 'past';
    } else if (diff < 0) {
        day = 0;
        state = 'future';
    } else {
        day = toYmd(today).d;
        state = 'current';
    }
    const daysLeft = state === 'past' ? 0 : state === 'future' ? days : days - day + 1;
    return { day, days, daysLeft, pct: days ? (day / days) * 100 : 0, state };
}

/**
 * Safe to spend per day = what is left of the monthly budget after what was spent and what is
 * still to be paid (upcoming), spread over the remaining days (today included).
 * Returns null when there is no budget or the month is over; never negative.
 */
export function safeToSpendPerDay({ budget, spent = 0, upcoming = 0, month, today = new Date() } = {}) {
    if (!(Number(budget) > 0)) return null;
    const { daysLeft } = monthProgress(month || today, today);
    if (daysLeft <= 0) return null;
    const left = Number(budget) - (Number(spent) || 0) - (Number(upcoming) || 0);
    return Math.max(0, left) / daysLeft;
}
