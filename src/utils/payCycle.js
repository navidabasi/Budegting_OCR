// Salary-to-salary cycles (pass 2, section 4). Pure; dates are 'YYYY-MM-DD' strings, so there is no timezone drift.
//
// Boundary rule (the only one): a cycle STARTS on its payday, inclusive, and ends the day before the next cycle starts.
// A purchase belongs to the cycle that contains its PURCHASE date: never the date it was scanned, saved or synced.
//
// Cycle id = the 'YYYY-MM' of the month its payday falls in (cycle '2026-10' starts on the Oct payday). The cycle that has
// no override of its own starts on:
//   - the configured payday, clamped to the length of the month (payday 31 -> 28 Feb, 30 Apr), then
//   - moved to the previous Friday when the 'previous' weekend rule is on and the day is a Saturday or Sunday.
// Real pay dates differ (early/late salary, holidays): a per-cycle override sets the actual start date.
//
// Changing the payday never rewrites history by accident: settings are a list of rules with an effective-from cycle, and a
// change that would move purchases between cycles is previewed first (previewRuleChange).
import { addDays, addMonths, daysBetween, daysInMonth, monthKey, toYmd } from './monthMath';
import { defaultPrevious, toRange } from './period';

export const DEFAULT_TIMEZONE = 'Europe/Rome';
export const WEEKEND_RULES = ['none', 'previous'];
const FIRST = '0000-01';
const pad = (n) => String(n).padStart(2, '0');
const CYCLE_ID = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date ('YYYY-MM-DD') in an IANA timezone. Falls back to the device's local date when the zone is unknown. */
export function todayInTimezone(timeZone = DEFAULT_TIMEZONE, now = new Date()) {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    } catch {
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
}

export const isValidTimezone = (tz) => {
    try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return typeof tz === 'string' && tz.length > 0;
    } catch {
        return false;
    }
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * normalizeConfig(raw) -> { configured, timezone, rules[{ from, payday, weekendRule }], overrides[{ cycle, start }] }
 * Missing or invalid settings mean "calendar months" (payday 1): the app behaves as it did before cycles existed
 * until the user sets a payday (`configured` is false then, so the UI can offer to set it).
 */
export function normalizeConfig(raw) {
    const rules = (Array.isArray(raw?.rules) ? raw.rules : [])
        .map((r) => ({ from: CYCLE_ID.test(r?.from) ? r.from : FIRST, payday: Math.min(31, Math.max(1, Math.round(Number(r?.payday)) || 1)), weekendRule: WEEKEND_RULES.includes(r?.weekendRule) ? r.weekendRule : 'none' }))
        .sort((a, b) => a.from.localeCompare(b.from));
    if (rules.length) rules[0] = { ...rules[0], from: FIRST };
    const overrides = (Array.isArray(raw?.overrides) ? raw.overrides : [])
        .filter((o) => CYCLE_ID.test(o?.cycle) && DATE.test(o?.start))
        .map((o) => ({ cycle: o.cycle, start: o.start }))
        .sort((a, b) => a.cycle.localeCompare(b.cycle));
    return {
        configured: rules.length > 0,
        timezone: isValidTimezone(raw?.timezone) ? raw.timezone : DEFAULT_TIMEZONE,
        rules: rules.length ? rules : [{ from: FIRST, payday: 1, weekendRule: 'none' }],
        overrides,
    };
}

/** The rule in force for a cycle: the latest rule whose effective-from cycle is not after it. */
export function ruleFor(cycleId, config) {
    const c = normalizeConfig(config);
    let rule = c.rules[0];
    for (const r of c.rules) if (r.from <= cycleId) rule = r;
    return rule;
}

// ---------------------------------------------------------------------------
// Cycle boundaries
// ---------------------------------------------------------------------------

/** The start the payday rule gives for a cycle, before any manual override. */
export function nominalStart(cycleId, rule) {
    const p = toYmd(cycleId);
    const day = Math.min(rule.payday, daysInMonth(cycleId));
    const date = `${p.y}-${pad(p.m)}-${pad(day)}`;
    if (rule.weekendRule !== 'previous') return date;
    const dow = new Date(Date.UTC(p.y, p.m - 1, day)).getUTCDay(); // 0 Sunday .. 6 Saturday
    if (dow === 6) return addDays(date, -1);
    if (dow === 0) return addDays(date, -2);
    return date;
}

/** Actual start of a cycle: its override when the user set one, else the payday rule's date. */
export function cycleStart(cycleId, config) {
    const c = normalizeConfig(config);
    const override = c.overrides.find((o) => o.cycle === cycleId);
    return override ? override.start : nominalStart(cycleId, ruleFor(cycleId, c));
}

/** Inclusive range of a cycle: { id, start, end, days }. */
export function cycleRange(cycleId, config) {
    const c = normalizeConfig(config);
    const start = cycleStart(cycleId, c);
    const end = addDays(cycleStart(addMonths(cycleId, 1), c), -1);
    return { id: cycleId, start, end, days: daysBetween(start, end) + 1 };
}

/** The cycle a purchase date belongs to. Boundary day = first day of the new cycle. Returns the cycle id. */
export function cycleIdForDate(date, config) {
    const c = normalizeConfig(config);
    const d = typeof date === 'string' ? date.slice(0, 10) : '';
    const base = monthKey(d);
    if (!base) return '';
    let best = addMonths(base, -2);
    for (const id of [addMonths(base, -2), addMonths(base, -1), base, addMonths(base, 1)]) {
        if (cycleStart(id, c) <= d) best = id;
    }
    return best;
}

export const cycleForDate = (date, config) => {
    const id = cycleIdForDate(date, config);
    return id ? cycleRange(id, config) : null;
};

export function currentCycleId(config, now = new Date()) {
    const c = normalizeConfig(config);
    return cycleIdForDate(todayInTimezone(c.timezone, now), c);
}

/** Can the start of `cycleId` be moved to `start`? It must stay after the previous cycle's start and before the next one's. */
export function validateOverride(cycleId, start, config) {
    if (!DATE.test(start) || !CYCLE_ID.test(cycleId)) return { ok: false, reason: 'invalid' };
    const c = normalizeConfig(config);
    const without = { ...c, overrides: c.overrides.filter((o) => o.cycle !== cycleId) };
    const prevStart = cycleStart(addMonths(cycleId, -1), without);
    const nextStart = cycleStart(addMonths(cycleId, 1), without);
    if (start <= prevStart) return { ok: false, reason: 'before_previous' };
    if (start >= nextStart) return { ok: false, reason: 'after_next' };
    return { ok: true };
}

/** Set (or clear with start = null) the actual start of one cycle. Returns a new raw config; throws on an invalid date. */
export function withOverride(config, cycleId, start) {
    const c = normalizeConfig(config);
    const overrides = c.overrides.filter((o) => o.cycle !== cycleId);
    if (start && start !== nominalStart(cycleId, ruleFor(cycleId, c))) {
        const v = validateOverride(cycleId, start, c);
        if (!v.ok) throw new Error(v.reason);
        overrides.push({ cycle: cycleId, start });
    }
    return { timezone: c.timezone, rules: c.configured ? c.rules : [], overrides };
}

/** Add or replace a payday rule effective from `fromCycle` (rules from that cycle on are dropped first). */
export function withRule(config, { payday, weekendRule = 'none', from = FIRST }) {
    const c = normalizeConfig(config);
    const kept = c.configured ? c.rules.filter((r) => r.from < from) : [];
    return { timezone: c.timezone, rules: [...kept, { from, payday, weekendRule }], overrides: c.overrides };
}

// ---------------------------------------------------------------------------
// Period objects for the app (see period.js): { kind, id, start, end, days, history[] }
// ---------------------------------------------------------------------------
const HISTORY = 12;

export function cyclePeriod(cycleId, config) {
    const r = cycleRange(cycleId, config);
    return {
        kind: 'cycle',
        id: cycleId,
        start: r.start,
        end: r.end,
        days: r.days,
        history: Array.from({ length: HISTORY }, (_, i) => {
            const id = addMonths(cycleId, i - HISTORY);
            const h = cycleRange(id, config);
            return { kind: 'cycle', id, start: h.start, end: h.end, days: h.days };
        }),
    };
}

export function monthPeriod(month) {
    const r = toRange(month);
    return {
        kind: 'month',
        id: month,
        start: r.start,
        end: r.end,
        days: daysBetween(r.start, r.end) + 1,
        history: Array.from({ length: HISTORY }, (_, i) => {
            const id = addMonths(month, i - HISTORY);
            const h = toRange(id);
            return { kind: 'month', id, start: h.start, end: h.end, days: daysBetween(h.start, h.end) + 1 };
        }),
    };
}

export function rangePeriod(start, end) {
    const days = daysBetween(start, end) + 1;
    const history = [];
    let cur = { start, end };
    for (let i = 0; i < HISTORY; i++) {
        cur = defaultPrevious(cur);
        history.unshift({ kind: 'range', id: `${cur.start}..${cur.end}`, start: cur.start, end: cur.end, days });
    }
    return { kind: 'range', id: `${start}..${end}`, start, end, days, history };
}

/** URL/state spec of a period: 'c:2026-10' (cycle), '2026-11' (calendar month), 'r:2026-10-01..2026-10-20' (custom range). */
export const periodSpec = (p) => (p.kind === 'cycle' ? `c:${p.id}` : p.kind === 'range' ? `r:${p.start}..${p.end}` : p.id);

/** Spec -> period, or null when it is not a valid spec. `all` is not a period. */
export function periodFromSpec(spec, config) {
    if (typeof spec !== 'string') return null;
    if (CYCLE_ID.test(spec)) return monthPeriod(spec);
    const c = /^c:(\d{4}-\d{2})$/.exec(spec);
    if (c && CYCLE_ID.test(c[1])) return cyclePeriod(c[1], config);
    const r = /^r:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(spec);
    if (r && r[1] <= r[2]) return rangePeriod(r[1], r[2]);
    return null;
}

/** The pay cycle containing today (in the configured timezone) as a period. */
export function currentCyclePeriod(config, now = new Date()) {
    return cyclePeriod(currentCycleId(config, now), config);
}

// ---------------------------------------------------------------------------
// Previews and suggestions
// ---------------------------------------------------------------------------

/**
 * How many transactions would land in a different cycle if the config changed (settings change that also rewrites
 * history, or an override). [{ id, date, from, to }] - show this before applying anything.
 */
export function previewConfigChange(transactions = [], oldConfig, newConfig) {
    const moved = [];
    for (const tx of transactions) {
        const d = String(tx?.date || '').slice(0, 10);
        if (!d) continue;
        const a = cycleIdForDate(d, oldConfig);
        const b = cycleIdForDate(d, newConfig);
        if (a !== b) moved.push({ id: tx.id, date: d, from: a, to: b });
    }
    return moved;
}

/**
 * Salary is not the only income: a cycle starts on the payday setting, not on any income. To help set an early or late start,
 * suggest the largest income within `windowDays` of the nominal start. { date, amount, id } or null.
 */
export function suggestSalaryStart(transactions = [], cycleId, config, { windowDays = 7 } = {}) {
    const nominal = nominalStart(cycleId, ruleFor(cycleId, config));
    let best = null;
    for (const tx of transactions) {
        if ((tx.transactionType || 'expense') !== 'income') continue;
        const d = String(tx.date || '').slice(0, 10);
        if (!d || Math.abs(daysBetween(nominal, d)) > windowDays) continue;
        const amount = Number(tx.amountBase ?? tx.total) || 0;
        if (!best || amount > best.amount) best = { date: d, amount, id: tx.id };
    }
    return best;
}

/** Label data for "12 Oct – 11 Nov · 9 days left": { start, end, daysLeft, day, days, state }. */
export function describeCycle(period, today) {
    const r = toRange(period);
    const t = typeof today === 'string' ? today : todayInTimezone(DEFAULT_TIMEZONE, today);
    const days = daysBetween(r.start, r.end) + 1;
    if (t > r.end) return { ...r, days, day: days, daysLeft: 0, state: 'past' };
    if (t < r.start) return { ...r, days, day: 0, daysLeft: days, state: 'future' };
    const day = daysBetween(r.start, t) + 1;
    return { ...r, days, day, daysLeft: days - day + 1, state: 'current' };
}

/** The "full previous period" function comparablePeriods() needs, for a period of any kind. */
export function previousOfPeriod(period, config) {
    if (typeof period === 'object' && period?.kind === 'cycle') return () => cycleRange(addMonths(period.id, -1), config);
    if (typeof period === 'object' && period?.kind === 'range') return (r) => defaultPrevious(r);
    return (r) => {
        const p = toYmd(r.start);
        const prev = p.m === 1 ? `${p.y - 1}-12` : `${p.y}-${pad(p.m - 1)}`;
        return toRange(prev);
    };
}
