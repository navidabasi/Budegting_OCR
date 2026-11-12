// Spending patterns (assistant v2, B-T1). Pure: same input -> same output, no I/O, no clock (pass `today`).
//
// Deterministic detectors of habits in the owner's own records. They feed the `patterns` chat intent, the "Your patterns" cards
// on Insights and the monthly narrative. Every number a card or an explanation may state is produced here.
//   row: { id, key, kind, i18nKey, params, severity ('watch' | 'info'), scope: { start, end }, evidence: [txId], filter }
// `key` is stable across periods (kind + subject) and is what "Hide" remembers (the same 60-day mechanism as the opportunities).
//
// Same honesty rules as savingsOpportunities.js: the owner's share of split expenses, expenses only (no planned bills, transfers,
// income, demo rows, unconverted foreign amounts or trip spending), fixed costs (rent, utilities, insurance, debt) left out of
// habits, a running period compared on its elapsed days only, and nothing at all with fewer than 3 earlier periods of data.
import { displayName, merchantKey } from '../utils/merchant';
import { addDays, dateKey, daysBetween } from '../utils/monthMath';
import { inPeriod, periodKey, periodProgress, previousPeriods, toRange } from '../utils/period';
import { excludedTripIds, isPlanned, round2, shareAmount, typeOf } from '../utils/money';
import { isUnconverted } from '../utils/baseCurrency';
import { spendClass } from '../utils/spendClass';
import { isDismissed } from './savingsOpportunities';

export const PATTERN_KINDS = ['weekend_heavy', 'small_purchases', 'first_week_spike', 'merchant_cadence', 'category_streak', 'payday_effect'];
export const MAX_PATTERNS = 4;
const MAX_EVIDENCE = 8;

export const LIMITS = {
    minHistoryPeriods: 3,
    maxHistoryPeriods: 6,
    minElapsedDays: 7,
    weekendMinRatio: 1.5, // weekend spend per day vs weekday spend per day
    weekendMinTotal: 50,
    smallTicket: 10,
    smallMinCount: 8,
    smallMinTotal: 30,
    smallMinRise: 0.25,
    smallMinRiseAmount: 10,
    firstWeekDays: 7,
    firstWeekMinShare: 0.4, // a spread-out period would put ~23% in its first 7 days
    cadenceMinVisits: 8,
    cadenceMaxGap: 7, // at least once a week on average
    streakMinPeriods: 3,
    streakMinStep: 0.05,
    streakMinStepAmount: 5,
    paydayDays: 3,
    paydayMinRatio: 1.6,
    paydayMinCount: 3,
    paydayMinIncome: 300,
};

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const minDate = (a, b) => (a < b ? a : b);
const keyOf = (tx) => tx.merchantKey || merchantKey(tx.merchant) || '';
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const isWeekend = (d) => dow(d) === 0 || dow(d) === 6;
const top = (rows, n = MAX_EVIDENCE) => [...rows].sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date)).slice(0, n).map((r) => r.id);
const inRange = (r, range) => r.date >= range.start && r.date <= range.end;
const daysIn = (range) => daysBetween(range.start, range.end) + 1;
const countDays = (range, pred) => {
    let n = 0;
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) if (pred(d)) n += 1;
    return n;
};

function buildContext({ transactions = [], groups = [], trips = [], accounts = [], period, today = new Date(), limits = {} }) {
    const L = { ...LIMITS, ...limits };
    const txs = (transactions || []).filter((t) => t && !t.isDemo);
    const tripIds = excludedTripIds(trips);
    const lookups = { groups: [...(groups || []), ...(trips || [])], accounts };
    const rows = [];
    const income = [];
    for (const tx of txs) {
        const date = dateKey(tx.date);
        if (!date || isPlanned(tx) || isUnconverted(tx)) continue;
        if (typeOf(tx) === 'income') {
            income.push({ id: tx.id, date, amount: Number(tx.total) || 0 });
            continue;
        }
        if (typeOf(tx) !== 'expense') continue;
        if (tx.groupId && tripIds.has(tx.groupId)) continue;
        const cls = spendClass(tx, lookups);
        rows.push({ id: tx.id, date, amount: shareAmount(tx), key: keyOf(tx), name: displayName(tx.merchant) || tx.merchant || keyOf(tx), category: tx.category || 'Other', flexible: cls === 'flexible' });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
    const range = toRange(period);
    const progress = periodProgress(period, today);
    const todayKey = dateKey(today);
    const firstDate = txs.map((t) => dateKey(t.date)).filter(Boolean).sort()[0] || null;
    const elapsed = progress.state === 'current' ? progress.day : progress.days;
    const history = range
        ? previousPeriods(period, L.maxHistoryPeriods)
              .map((p) => toRange(p))
              // a period the owner only started recording part-way through would look like a quiet period: it does not count
              .filter((r) => r && firstDate && daysBetween(r.start, firstDate) <= 3 && txs.some((t) => inPeriod(t.date, r)))
        : [];
    const current = range ? { start: range.start, end: minDate(addDays(range.start, elapsed - 1), range.end) } : null;
    // the habit window: the earlier periods with data plus the elapsed part of this one
    const oldest = history.length ? history.map((r) => r.start).sort()[0] : null;
    const window = current && oldest ? { start: oldest, end: current.end } : null;
    return { L, rows, income, range, progress, todayKey, history: history.sort((a, b) => a.start.localeCompare(b.start)), current, window, running: progress.state === 'current', elapsed, pk: periodKey(period) };
}

const make = (ctx, kind, subject, o) => {
    const key = `pattern_${kind}:${subject}`;
    return { id: `${key}@${ctx.pk}`, key, kind, i18nKey: `pattern.${kind}`, params: o.params, severity: o.severity || 'info', score: round2(o.score || 0), scope: o.scope || ctx.window, evidence: o.evidence || [], filter: o.filter || null };
};

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------
/** Weekend days cost much more per day than weekdays (flexible spending over the habit window). */
function weekendHeavy(ctx) {
    const rows = ctx.rows.filter((r) => r.flexible && inRange(r, ctx.window));
    const we = rows.filter((r) => isWeekend(r.date));
    const weTotal = round2(sum(we.map((r) => r.amount)));
    const wdTotal = round2(sum(rows.filter((r) => !isWeekend(r.date)).map((r) => r.amount)));
    const weDays = countDays(ctx.window, isWeekend);
    const wdDays = daysIn(ctx.window) - weDays;
    if (!weDays || !wdDays || weTotal < ctx.L.weekendMinTotal) return [];
    const perWe = round2(weTotal / weDays);
    const perWd = round2(wdTotal / wdDays);
    if (perWd <= 0 || perWe < perWd * ctx.L.weekendMinRatio) return [];
    const total = weTotal + wdTotal;
    return [make(ctx, 'weekend_heavy', 'all', { params: { weekendPerDay: perWe, weekdayPerDay: perWd, ratio: round2(perWe / perWd), weekendPct: Math.round((weTotal / total) * 100), weekendTotal: weTotal, days: daysIn(ctx.window) }, severity: 'watch', score: perWe - perWd, evidence: top(we) })];
}

/** Many small purchases (< 10) this period, clearly more than in the earlier periods at the same point. */
function smallPurchases(ctx) {
    const L = ctx.L;
    const small = ctx.rows.filter((r) => r.flexible && r.amount > 0 && r.amount < L.smallTicket);
    const cut = (r) => ({ start: r.start, end: minDate(addDays(r.start, ctx.elapsed - 1), r.end) });
    const now = small.filter((r) => inRange(r, ctx.current));
    const count = now.length;
    const total = round2(sum(now.map((r) => r.amount)));
    const before = ctx.history.map((h) => small.filter((r) => inRange(r, cut(h))));
    const baseCount = round2(sum(before.map((b) => b.length)) / before.length);
    const baseTotal = round2(sum(before.map((b) => sum(b.map((r) => r.amount)))) / before.length);
    if (count < L.smallMinCount || total < L.smallMinTotal) return [];
    if (total < baseTotal * (1 + L.smallMinRise) || total - baseTotal < L.smallMinRiseAmount) return [];
    return [make(ctx, 'small_purchases', 'all', { params: { count, total, baselineCount: baseCount, baselineTotal: baseTotal, under: L.smallTicket, extra: round2(total - baseTotal), elapsedDays: ctx.elapsed }, severity: 'watch', score: total - baseTotal, scope: ctx.current, evidence: top(now), filter: { max: L.smallTicket } })];
}

/** In complete earlier periods, a large share of flexible spending lands in the first days after the period starts. */
function firstWeekSpike(ctx) {
    const L = ctx.L;
    const flex = ctx.rows.filter((r) => r.flexible);
    const shares = [];
    let firstSum = 0;
    let restSum = 0;
    let firstDays = 0;
    let restDays = 0;
    const ids = [];
    for (const h of ctx.history) {
        const first = { start: h.start, end: minDate(addDays(h.start, L.firstWeekDays - 1), h.end) };
        const inH = flex.filter((r) => inRange(r, h));
        const total = sum(inH.map((r) => r.amount));
        if (total <= 0) continue;
        const f = inH.filter((r) => inRange(r, first));
        const fs = sum(f.map((r) => r.amount));
        shares.push(fs / total);
        firstSum += fs;
        restSum += total - fs;
        firstDays += daysIn(first);
        restDays += daysIn(h) - daysIn(first);
        ids.push(...f);
    }
    if (shares.length < L.minHistoryPeriods) return [];
    const share = sum(shares) / shares.length;
    if (share < L.firstWeekMinShare || !restDays) return [];
    return [make(ctx, 'first_week_spike', 'all', { params: { firstWeekPct: Math.round(share * 100), days: L.firstWeekDays, periods: shares.length, perDayFirstWeek: round2(firstSum / firstDays), perDayRest: round2(restSum / restDays) }, severity: 'info', score: share * 100, evidence: top(ids) })];
}

/** The merchant visited most often, when visits are only a few days apart (the coffee bar, the corner shop). */
function merchantCadence(ctx) {
    const L = ctx.L;
    const rows = ctx.rows.filter((r) => r.flexible && r.key && inRange(r, ctx.window));
    const by = new Map();
    for (const r of rows) by.set(r.key, [...(by.get(r.key) || []), r]);
    const days = daysIn(ctx.window);
    const best = [...by.values()]
        .filter((list) => new Set(list.map((r) => r.date)).size >= L.cadenceMinVisits)
        .map((list) => ({ list, visits: new Set(list.map((r) => r.date)).size }))
        .map((x) => ({ ...x, everyDays: round2(days / x.visits) }))
        .filter((x) => x.everyDays <= L.cadenceMaxGap)
        .sort((a, b) => b.visits - a.visits || sum(b.list.map((r) => r.amount)) - sum(a.list.map((r) => r.amount)))[0];
    if (!best) return [];
    const total = round2(sum(best.list.map((r) => r.amount)));
    const r0 = best.list[0];
    return [make(ctx, 'merchant_cadence', r0.key, { params: { merchant: r0.name, visits: best.visits, everyDays: Math.round(best.everyDays * 10) / 10, total, perVisit: round2(total / best.list.length), perMonth: round2((total / days) * 30), days }, severity: 'info', score: best.visits, evidence: top(best.list), filter: { merchant: r0.name } })];
}

/** A category that rose (or fell) in each of the last 3+ complete periods. */
function categoryStreak(ctx) {
    const L = ctx.L;
    const flex = ctx.rows.filter((r) => r.flexible && r.category !== 'Other');
    const out = [];
    for (const c of [...new Set(flex.map((r) => r.category))]) {
        const series = ctx.history.map((h) => round2(sum(flex.filter((r) => r.category === c && inRange(r, h)).map((r) => r.amount))));
        for (const dir of ['up', 'down']) {
            let n = 1;
            for (let i = series.length - 1; i > 0; i -= 1) {
                const [a, b] = [series[i - 1], series[i]];
                const step = dir === 'up' ? b - a : a - b;
                if (a > 0 && step >= Math.max(L.streakMinStepAmount, a * L.streakMinStep)) n += 1;
                else break;
            }
            if (n < L.streakMinPeriods) continue;
            const used = series.slice(-n);
            const ranges = ctx.history.slice(-n);
            const scope = { start: ranges[0].start, end: ranges[ranges.length - 1].end };
            out.push(make(ctx, 'category_streak', `${c}:${dir}`, { params: { category: c, direction: dir, periods: n, first: used[0], last: used[used.length - 1], change: round2(used[used.length - 1] - used[0]), amounts: used }, severity: dir === 'up' ? 'watch' : 'info', score: Math.abs(used[used.length - 1] - used[0]), scope, evidence: top(flex.filter((r) => r.category === c && inRange(r, ranges[ranges.length - 1]))), filter: { category: c } }));
        }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 2);
}

/** Spending in the days right after income arrives is much higher per day than on the other days. */
function paydayEffect(ctx) {
    const L = ctx.L;
    const paydays = [...new Set(ctx.income.filter((i) => i.amount >= L.paydayMinIncome && i.date >= ctx.window.start && i.date <= ctx.window.end).map((i) => i.date))].sort();
    if (paydays.length < L.paydayMinCount) return [];
    const after = new Set();
    for (const d of paydays) for (let k = 0; k < L.paydayDays; k += 1) if (addDays(d, k) <= ctx.window.end) after.add(addDays(d, k));
    const rows = ctx.rows.filter((r) => r.flexible && inRange(r, ctx.window));
    const a = rows.filter((r) => after.has(r.date));
    const aTotal = sum(a.map((r) => r.amount));
    const oTotal = sum(rows.map((r) => r.amount)) - aTotal;
    const otherDays = daysIn(ctx.window) - after.size;
    if (!after.size || !otherDays || oTotal <= 0) return [];
    const perAfter = round2(aTotal / after.size);
    const perOther = round2(oTotal / otherDays);
    if (perAfter < perOther * L.paydayMinRatio) return [];
    return [make(ctx, 'payday_effect', 'all', { params: { paydays: paydays.length, days: L.paydayDays, perDayAfter: perAfter, perDayOther: perOther, ratio: round2(perAfter / perOther) }, severity: 'watch', score: perAfter - perOther, evidence: top(a) })];
}

/**
 * computePatterns({ transactions, groups, trips, accounts, period, today, dismissed, limit }) -> { top, all, dismissed }
 * Nothing fires before there are 3 earlier periods with data, or in the first days of a running period.
 */
export function computePatterns(input = {}) {
    const { dismissed = {}, limit = MAX_PATTERNS, today = new Date() } = input;
    const ctx = buildContext({ ...input, today });
    const empty = { top: [], all: [], dismissed: [] };
    if (!ctx.range || ctx.progress.state === 'future' || ctx.history.length < ctx.L.minHistoryPeriods || !ctx.window) return empty;
    if (ctx.running && ctx.elapsed < ctx.L.minElapsedDays) return empty;
    const all = [...weekendHeavy(ctx), ...smallPurchases(ctx), ...firstWeekSpike(ctx), ...merchantCadence(ctx), ...categoryStreak(ctx), ...paydayEffect(ctx)];
    const order = (a, b) => (a.severity === b.severity ? b.score - a.score || a.id.localeCompare(b.id) : a.severity === 'watch' ? -1 : 1);
    const hidden = all.filter((p) => isDismissed(p.key, dismissed, today));
    return { top: all.filter((p) => !hidden.includes(p)).sort(order).slice(0, limit), all: [...all].sort(order), dismissed: hidden };
}

/** The patterns as the model sees them (chat facts and insights aggregates): kind, figures and dates, no record ids. */
export const toModelPatterns = (list = []) => list.map((p) => ({ patternKind: p.kind, severity: p.severity, periodStart: p.scope?.start || null, periodEnd: p.scope?.end || null, ...p.params }));
