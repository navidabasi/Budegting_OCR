// Period ranges shared by money, item analysis and the screens (pass 2). A period is either a calendar month key
// ('YYYY-MM') or a range object { start, end } of inclusive 'YYYY-MM-DD' dates (pay cycles and custom ranges, see payCycle.js).
// Pure; date strings only, no timezone drift.
import { addDays, addMonths, dateKey, daysBetween, monthEnd, monthKey, monthStart, previousMonths, toYmd } from './monthMath';

/** { start, end } inclusive for a month key or a range-like object; null when invalid. */
export function toRange(period) {
    if (!period) return null;
    if (typeof period === 'string') {
        const s = monthStart(period);
        return s ? { start: s, end: monthEnd(period) } : null;
    }
    if (period.start && period.end) return { start: dateKey(period.start), end: dateKey(period.end) };
    return null;
}

/** Is the date (string/Date) inside the period (inclusive both ends)? The purchase date decides, never the sync or scan date. */
export function inPeriod(date, period) {
    const r = toRange(period);
    const d = dateKey(date);
    return !!r && !!d && d >= r.start && d <= r.end;
}

/** Days in the range (inclusive). */
export const rangeDays = (period) => {
    const r = toRange(period);
    return r ? daysBetween(r.start, r.end) + 1 : 0;
};

/**
 * Where `today` sits in a period: { day, days, daysLeft, pct, state: 'past' | 'current' | 'future' }.
 * daysLeft counts today; a past period has day = days and daysLeft = 0.
 */
export function periodProgress(period, today = new Date()) {
    const r = toRange(period);
    const t = dateKey(today);
    if (!r || !t) return { day: 0, days: 0, daysLeft: 0, pct: 0, state: 'future' };
    const days = daysBetween(r.start, r.end) + 1;
    if (t > r.end) return { day: days, days, daysLeft: 0, pct: 100, state: 'past' };
    if (t < r.start) return { day: 0, days, daysLeft: days, pct: 0, state: 'future' };
    const day = daysBetween(r.start, t) + 1;
    return { day, days, daysLeft: days - day + 1, pct: (day / days) * 100, state: 'current' };
}

/**
 * The comparable earlier period (pass 2, section 4): completed vs completed, active vs the same elapsed portion of the
 * previous one. `previousOf(range)` gives the full previous period of the same kind (a month, a pay cycle, an equal-length
 * range). Returns { current, previous, basis: 'completed' | 'elapsed', elapsedDays, totalDays } where for 'elapsed' both ranges
 * are cut to the same number of elapsed days.
 */
export function comparablePeriods(period, today = new Date(), previousOf) {
    const cur = toRange(period);
    if (!cur) return null;
    const prev = previousOf ? toRange(previousOf(cur)) : defaultPrevious(cur);
    if (!prev) return null;
    const progress = periodProgress(cur, today);
    if (progress.state === 'current') {
        const elapsed = progress.day;
        const cut = (r) => ({ start: r.start, end: minDate(addDays(r.start, elapsed - 1), r.end) });
        return { current: cut(cur), previous: cut(prev), full: { current: cur, previous: prev }, basis: 'elapsed', elapsedDays: elapsed, totalDays: progress.days };
    }
    return { current: cur, previous: prev, full: { current: cur, previous: prev }, basis: 'completed', elapsedDays: progress.days, totalDays: progress.days };
}

const minDate = (a, b) => (a < b ? a : b);

/** Previous range of equal length, directly before. */
export function defaultPrevious(range) {
    const days = daysBetween(range.start, range.end) + 1;
    return { start: addDays(range.start, -days), end: addDays(range.start, -1) };
}

/** Previous calendar month of a month-range (used when the current period is a calendar month). */
export function previousMonthRange(range) {
    const p = toYmd(range.start);
    const prevMonth = p.m === 1 ? `${p.y - 1}-12` : `${p.y}-${String(p.m - 1).padStart(2, '0')}`;
    return toRange(prevMonth);
}

/** Label for a range: "12 Oct – 11 Nov" (year added when it is not the current year). */
export function formatRange(period, languageCode = 'en', today = new Date()) {
    const r = toRange(period);
    if (!r) return '';
    const fmt = (key, withYear) => {
        const p = toYmd(key);
        return new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).format(new Date(p.y, p.m - 1, p.d));
    };
    const ty = toYmd(today).y;
    const sameYear = toYmd(r.start).y === toYmd(r.end).y;
    const showYear = !sameYear || toYmd(r.end).y !== ty;
    return `${fmt(r.start, showYear && !sameYear)} – ${fmt(r.end, showYear)}`;
}

// ---------------------------------------------------------------------------
// Adapters so month-based maths accept a month key or a period object (payCycle.js builds the objects)
// ---------------------------------------------------------------------------

/** Stable id of a period for maps and cache keys: the month key, the cycle id or 'start..end'. */
export function periodKey(period) {
    if (typeof period === 'string') return period;
    if (period?.id) return period.id;
    const r = toRange(period);
    return r ? `${r.start}..${r.end}` : '';
}

export const periodStart = (period) => toRange(period)?.start || '';
export const periodEnd = (period) => toRange(period)?.end || '';

/**
 * The `n` periods before `period`, oldest first, of the same kind. A month key gives month keys (as previousMonths);
 * a period object gives the period objects of its precomputed history.
 */
export function previousPeriods(period, n = 3) {
    if (typeof period === 'string') return previousMonths(period, n);
    const h = Array.isArray(period?.history) ? period.history : [];
    if (h.length >= n) return h.slice(h.length - n);
    // no (or short) history: equal-length ranges directly before
    const out = [...h];
    let cur = out.length ? toRange(out[0]) : toRange(period);
    while (out.length < n && cur) {
        cur = defaultPrevious(cur);
        out.unshift({ kind: 'range', id: `${cur.start}..${cur.end}`, start: cur.start, end: cur.end });
    }
    return out.slice(out.length - n);
}

/** The calendar month a period mostly belongs to (its end month): used where a month is still needed (goal target months). */
export const anchorMonth = (period) => monthKey(periodEnd(period)) || (typeof period === 'string' ? period : '');
export { addMonths };

/** URL/state spec of any period: a month key stays as is, a cycle is 'c:YYYY-MM', a range 'r:start..end'. */
export const periodSpecOf = (period) => {
    if (typeof period === 'string') return period;
    if (period?.kind === 'cycle') return `c:${period.id}`;
    if (period?.kind === 'range') return `r:${period.start}..${period.end}`;
    return period?.id || '';
};

/** Readable name of a period: "November 2026" for a month, "12 Oct – 11 Nov" for a cycle or range. */
export function labelOf(period, languageCode = 'en', { long = false, today = new Date() } = {}) {
    const month = typeof period === 'string' ? period : period?.kind === 'month' ? period.id : null;
    if (month) {
        const [y, m] = month.split('-').map(Number);
        try {
            const text = new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { month: long ? 'long' : 'short', year: 'numeric' }).format(new Date(y, m - 1, 1));
            return text.charAt(0).toUpperCase() + text.slice(1);
        } catch {
            return month;
        }
    }
    return formatRange(period, languageCode, today);
}
