// Savings opportunities (pass 3, A1). Pure: same input -> same output, no I/O, no clock (pass `today`).
//
// The app computes, the model explains: every number an explanation may state is produced here. An opportunity is
//   { id, key, kind, i18nKey, params, monthlySaving, yearlySaving, confidence (0..1), level, score, scope, evidence: [txId], action,
//     category, merchant, merchantName }
// `key` is stable across periods (kind + subject) and is what "Not useful" remembers; `id` adds the period.
// `scope` is the exact date range the numbers were computed over ({ start, end }); the action link opens exactly that.
//
// Rules that keep the advice honest
//  - Amounts are the owner's share of split expenses (money.shareAmount), in the base currency; planned bills, transfers, income,
//    demo rows and trip spending are left out.
//  - Rent, housing, utilities and insurance are fixed costs: they are never called a subscription and never "to cut"; the only thing
//    suggested for them is marking them recurring (kind `fixed_cost`). Klarna, loans and paying friends back are debt (`debt_cost`).
//  - A running period is compared with the same number of elapsed days of earlier periods, never with a full period.
//  - History means the owner's own earlier periods; periods before the first recorded transaction do not count as "zero".
import { displayName, merchantKey } from '../utils/merchant';
import { addDays, dateKey, daysBetween } from '../utils/monthMath';
import { inPeriod, periodKey, periodProgress, previousPeriods, toRange } from '../utils/period';
import { excludedTripIds, isPlanned, monthTotals, round2, shareAmount, typeOf, accountBalances } from '../utils/money';
import { activeBudgets } from '../utils/budgetMath';
import { goalMonthlyPace } from '../utils/savingsMath';
import { isUnconverted } from '../utils/baseCurrency';
import { normalizeItems } from '../utils/receiptItems';
import { baseQuantityOf, productKey, unitPriceOf } from '../utils/itemAnalysis';
import { spendClass } from '../utils/spendClass';
import { goalProgress } from './insightsAggregates';

export const OPPORTUNITY_KINDS = ['category_above_baseline', 'merchant_frequency', 'subscription_review', 'price_creep', 'cheaper_store', 'budget_gap', 'debt_cost', 'goal_boost', 'uncategorised_blind_spot', 'fixed_cost'];
export const OPPORTUNITY_ACTIONS = ['set_budget', 'mark_recurring', 'open_filter', 'add_goal', 'categorise', 'review_subscription'];
export const OPPORTUNITY_KEYS = OPPORTUNITY_KINDS.map((k) => `opp.${k}`);
export const DISMISS_DAYS = 60;
export const MAX_SHOWN = 5;
const MAX_PER_KIND = 2;
const MAX_EVIDENCE = 8;

export const LIMITS = {
    baselinePeriods: 3,
    minElapsedDays: 4,
    aboveMinAmount: 15,
    aboveMinPct: 0.2,
    frequencyMinCount: 4,
    frequencyMinPerWeek: 1.5,
    frequencyMaxTicket: 15,
    recurringGapDays: [26, 35],
    recurringAmountBand: [0.65, 1.5],
    recurringActiveDays: 45,
    unchangedMinCount: 3,
    creepMinPct: 0.03,
    creepMinAmount: 0.5,
    storeWindowDays: 90,
    storeMinVisits: 3,
    storeMinDiff: 3,
    gapMinMedian: 40,
    gapMinSpread: 0.3,
    blindSpotMinPct: 0.15,
    blindSpotMinCount: 3,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const median = (xs) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const minDate = (a, b) => (a < b ? a : b);
const keyOf = (tx) => tx.merchantKey || merchantKey(tx.merchant) || '';
const isUncategorisedName = (c) => !c || String(c).toLowerCase() === 'other';
const levelOf = (c) => (c >= 0.7 ? 'high' : c >= 0.45 ? 'medium' : 'low');
const top = (rows, n = MAX_EVIDENCE) => [...rows].sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date)).slice(0, n).map((r) => r.id);
const roundTo5 = (n) => Math.max(5, Math.round(n / 5) * 5);

/** Is the key hidden by "Not useful"? `dismissed` is { [key]: 'YYYY-MM-DD' } (the day it was dismissed). */
export function isDismissed(key, dismissed, today) {
    const at = dismissed && dismissed[key];
    if (!at) return false;
    const days = daysBetween(dateKey(at), dateKey(today));
    return days >= 0 && days < DISMISS_DAYS;
}

/** Drop dismissals older than 60 days (called when a new one is saved). */
export function pruneDismissed(dismissed = {}, today) {
    const out = {};
    for (const key of Object.keys(dismissed || {})) if (isDismissed(key, dismissed, today)) out[key] = dismissed[key];
    return out;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
function buildContext({ transactions = [], budgets = [], goals = [], accounts = [], trips = [], groups = [], period, today = new Date(), limits = {} }) {
    const txs = (transactions || []).filter((t) => t && !t.isDemo);
    const tripIds = excludedTripIds(trips);
    const lookups = { groups: [...(groups || []), ...(trips || [])], accounts };
    const rows = [];
    for (const tx of txs) {
        if (typeOf(tx) !== 'expense' || isPlanned(tx) || isUnconverted(tx)) continue;
        const date = dateKey(tx.date);
        if (!date) continue;
        rows.push({ id: tx.id, tx, date, amount: shareAmount(tx), key: keyOf(tx), name: displayName(tx.merchant) || tx.merchant || keyOf(tx), category: tx.category || 'Other', cls: spendClass(tx, lookups), trip: !!(tx.groupId && tripIds.has(tx.groupId)) });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
    const range = toRange(period);
    const progress = periodProgress(period, today);
    const todayKey = dateKey(today);
    const elapsed = progress.state === 'current' ? progress.day : progress.days;
    const cut = (p) => {
        const r = toRange(p);
        return { start: r.start, end: minDate(addDays(r.start, elapsed - 1), r.end) };
    };
    const firstDate = txs.map((t) => dateKey(t.date)).filter(Boolean).sort()[0] || null;
    // earlier periods of the same kind in which the owner was already recording
    const history = range
        ? previousPeriods(period, (limits.baselinePeriods || LIMITS.baselinePeriods))
              .map((p) => toRange(p))
              .filter((r) => r && firstDate && r.end >= firstDate && txs.some((t) => inPeriod(t.date, r)))
        : [];
    return {
        txs, rows, budgets, goals, accounts, trips, period, range, progress, todayKey, elapsed, cut, history, firstDate,
        running: progress.state === 'current',
        current: range ? cut(period) : null,
        until: range ? minDate(todayKey, range.end) : todayKey,
        pk: periodKey(period),
        L: { ...LIMITS, ...limits },
    };
}

const inRange = (r, range) => r.date >= range.start && r.date <= range.end;
const make = (ctx, kind, subject, o) => {
    const key = `${kind}:${subject}`;
    const monthlySaving = round2(Math.max(0, o.monthlySaving || 0));
    const confidence = Math.max(0, Math.min(1, o.confidence ?? 0.5));
    return {
        id: `${key}@${ctx.pk}`,
        key,
        kind,
        i18nKey: `opp.${kind}`,
        category: o.category || null,
        merchant: o.merchant || null,
        merchantName: o.merchantName || null,
        params: o.params || {},
        monthlySaving,
        yearlySaving: round2(monthlySaving * 12),
        confidence: round2(confidence),
        level: levelOf(confidence),
        score: round2(o.score ?? monthlySaving * confidence),
        scope: o.scope || ctx.current,
        evidence: o.evidence || [],
        action: o.action,
    };
};

// ---------------------------------------------------------------------------
// Recurring charges (subscriptions, fixed costs, instalments)
// ---------------------------------------------------------------------------
/**
 * Chains of charges at one merchant about a month apart. Unlike insightsEngine.detectSubscriptions this follows a price change
 * (so a rise can be reported) and keeps charges already marked recurring. A merchant visited many times a month (a supermarket)
 * is not a chain. -> [{ key, name, category, cls, count, amounts, dates, amount, lastDate, firstDate, marked, ids }]
 */
export function detectRecurringCharges(rows, { until, limits = LIMITS } = {}) {
    const [minGap, maxGap] = limits.recurringGapDays;
    const [lo, hi] = limits.recurringAmountBand;
    const byKey = new Map();
    for (const r of rows) {
        if (!r.key || r.trip || r.amount <= 0 || (until && r.date > until)) continue;
        if (!byKey.has(r.key)) byKey.set(r.key, []);
        byKey.get(r.key).push(r);
    }
    const out = [];
    for (const [key, list] of byKey) {
        const open = [];
        for (const item of list) {
            const chain = open.find((c) => {
                const last = c[c.length - 1];
                const gap = daysBetween(last.date, item.date);
                const ratio = item.amount / last.amount;
                return gap >= minGap && gap <= maxGap && ratio >= lo && ratio <= hi;
            });
            if (chain) chain.push(item);
            else open.push([item]);
        }
        for (const c of open) {
            if (c.length < 2) continue;
            const first = c[0].date;
            const last = c[c.length - 1];
            const mid = median(c.map((x) => x.amount));
            const similar = list.filter((x) => x.date >= first && x.date <= last.date && x.amount >= mid * lo && x.amount <= mid * hi).length;
            if (similar > c.length + 1) continue; // bought far more often than monthly: a shop, not a recurring charge
            out.push({ key, name: last.name, category: last.category, cls: last.cls, count: c.length, amounts: c.map((x) => round2(x.amount)), dates: c.map((x) => x.date), amount: round2(last.amount), lastDate: last.date, firstDate: first, marked: c.some((x) => !!x.tx.recurringData), ids: c.map((x) => x.id), last });
        }
    }
    return out.sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
}

const isActive = (chain, ctx) => daysBetween(chain.lastDate, ctx.until) <= ctx.L.recurringActiveDays && daysBetween(chain.lastDate, ctx.until) >= 0;

/** The last price rise of a chain that still holds: { from, to, increase, since } or null. Fixed costs need a stable price before the rise. */
function priceRise(chain, L) {
    const a = chain.amounts;
    for (let i = a.length - 1; i >= 1; i--) {
        const diff = a[i] - a[i - 1];
        if (diff >= L.creepMinAmount && diff >= a[i - 1] * L.creepMinPct) {
            if (a.slice(i).some((x) => x < a[i] * 0.99)) return null; // it went back down afterwards
            if (chain.cls === 'fixed' && !(i >= 2 && Math.abs(a[i - 1] - a[i - 2]) <= a[i - 1] * 0.01)) return null; // a bill that moves every month is not a price rise
            return { from: a[i - 1], to: a[a.length - 1], increase: round2(a[a.length - 1] - a[i - 1]), since: chain.dates[i] };
        }
        if (Math.abs(diff) > a[i - 1] * 0.01) return null; // the latest change was a drop
    }
    return null;
}

/**
 * A subscription charges the same price every time (one price change at most). Something bought about monthly for a different
 * amount each time (a restaurant, a monthly shop) is not one. Two charges are enough only when the owner filed it as a subscription.
 */
function looksLikeSubscription(chain, named) {
    const levels = [];
    for (const a of chain.amounts) if (!levels.some((l) => Math.abs(l - a) <= l * 0.05)) levels.push(a);
    return levels.length <= 2 && chain.count >= (named ? 2 : 3);
}

function recurringOpportunities(ctx) {
    const chains = detectRecurringCharges(ctx.rows, { until: ctx.until, limits: ctx.L }).filter((c) => isActive(c, ctx));
    const out = [];
    for (const c of chains) {
        const scopeAll = { start: c.firstDate, end: ctx.until };
        const namedSub = /subscription|abbonament|abo\b|suscrip|abonnement/i.test(`${c.category} ${c.last.tx.groupName || ''}`);
        const rise = (c.cls === 'flexible' && looksLikeSubscription(c, namedSub)) || c.cls === 'fixed' ? priceRise(c, ctx.L) : null;
        if (rise) {
            out.push(make(ctx, 'price_creep', c.key, {
                merchant: c.key, merchantName: c.name, category: c.category,
                params: { name: c.name, from: rise.from, to: rise.to, increase: rise.increase, since: rise.since, monthly: c.amount, yearly: round2(c.amount * 12), yearlyIncrease: round2(rise.increase * 12) },
                monthlySaving: rise.increase,
                confidence: c.amounts.filter((x) => Math.abs(x - rise.to) <= rise.to * 0.01).length >= 2 ? 0.75 : 0.6,
                score: rise.increase * 0.75 + (c.cls === 'flexible' ? c.amount * 0.4 : 0), // a rise is a stronger reason to review the same charge
                scope: scopeAll,
                evidence: c.ids.slice(-MAX_EVIDENCE),
                action: { type: 'review_subscription', merchant: c.key },
            }));
        }
        if (c.cls === 'fixed') {
            if (!c.marked) {
                out.push(make(ctx, 'fixed_cost', c.key, {
                    merchant: c.key, merchantName: c.name, category: c.category,
                    params: { name: c.name, amount: c.amount, months: c.count, yearly: round2(c.amount * 12) },
                    monthlySaving: 0, confidence: 0.9, score: 1 + Math.min(1, c.amount / 1000),
                    scope: scopeAll,
                    evidence: c.ids.slice(-MAX_EVIDENCE),
                    action: { type: 'mark_recurring', txId: c.last.id, frequency: 'monthly' },
                }));
            }
            continue;
        }
        if (c.cls !== 'flexible') continue; // instalments are reported by debt_cost
        let unchanged = 1;
        for (let i = c.amounts.length - 1; i >= 1 && Math.abs(c.amounts[i] - c.amounts[i - 1]) <= c.amounts[i] * 0.01; i--) unchanged += 1;
        const named = /subscription|abbonament|abo\b|suscrip|abonnement/i.test(`${c.category} ${c.last.tx.groupName || ''}`);
        if (!looksLikeSubscription(c, named)) continue; // a restaurant visited once a month is not a subscription
        out.push(make(ctx, 'subscription_review', c.key, {
            merchant: c.key, merchantName: c.name, category: c.category,
            params: { name: c.name, amount: c.amount, yearly: round2(c.amount * 12), months: c.count, unchangedMonths: unchanged >= ctx.L.unchangedMinCount ? unchanged : 0, since: c.firstDate },
            monthlySaving: c.amount,
            confidence: 0.3 + (named ? 0.1 : 0) + (unchanged >= ctx.L.unchangedMinCount ? 0.1 : 0),
            scope: scopeAll,
            evidence: c.ids.slice(-MAX_EVIDENCE),
            action: { type: 'review_subscription', merchant: c.key },
        }));
    }
    return { out, chains };
}

// ---------------------------------------------------------------------------
// Category above the owner's own baseline, and budgets that are missing
// ---------------------------------------------------------------------------
function categorySeries(ctx, { cutToElapsed }) {
    const flexible = ctx.rows.filter((r) => r.cls === 'flexible' && !r.trip && !isUncategorisedName(r.category));
    const categories = [...new Set(flexible.map((r) => r.category))];
    const ranges = ctx.history.map((r) => (cutToElapsed ? ctx.cut(r) : r));
    const series = new Map();
    for (const c of categories) series.set(c, ranges.map((range) => round2(sum(flexible.filter((r) => r.category === c && inRange(r, range)).map((r) => r.amount)))));
    return { flexible, categories, series };
}

// the first days of a running period are too few to judge a habit
const tooEarly = (ctx) => ctx.running && ctx.elapsed < ctx.L.minElapsedDays;

function categoryAboveBaseline(ctx) {
    if (!ctx.current || ctx.history.length === 0 || tooEarly(ctx)) return [];
    const { flexible, categories, series } = categorySeries(ctx, { cutToElapsed: true });
    const full = categorySeries(ctx, { cutToElapsed: false }).series;
    const budgeted = new Set(activeBudgets(ctx.budgets, ctx.period).map((b) => b.category));
    const out = [];
    for (const category of categories) {
        const past = series.get(category);
        const baseline = round2(median(past));
        const mine = flexible.filter((r) => r.category === category && inRange(r, ctx.current));
        const current = round2(sum(mine.map((r) => r.amount)));
        const excess = round2(current - baseline);
        if (baseline <= 0 || excess < ctx.L.aboveMinAmount || excess < baseline * ctx.L.aboveMinPct) continue;
        const suggested = roundTo5(median(full.get(category)));
        out.push(make(ctx, 'category_above_baseline', category, {
            category,
            params: { category, current, baseline, excess, pct: Math.round((excess / baseline) * 100), periods: past.length, elapsedDays: ctx.elapsed, totalDays: ctx.progress.days, running: ctx.running, suggestedBudget: suggested, count: mine.length },
            monthlySaving: excess,
            confidence: past.length >= 3 ? 0.8 : past.length === 2 ? 0.6 : 0.4,
            evidence: top(mine),
            action: budgeted.has(category) ? { type: 'open_filter', category } : { type: 'set_budget', category, amount: suggested },
        }));
    }
    return out;
}

function budgetGap(ctx, skip = new Set()) {
    if (!ctx.current || ctx.history.length < 2) return [];
    const { flexible, categories, series } = categorySeries(ctx, { cutToElapsed: false });
    const budgeted = new Set(activeBudgets(ctx.budgets, ctx.period).map((b) => b.category));
    const out = [];
    for (const category of categories) {
        if (budgeted.has(category) || skip.has(category)) continue;
        const past = series.get(category);
        const mid = median(past);
        if (mid < ctx.L.gapMinMedian) continue;
        const spread = (Math.max(...past) - Math.min(...past)) / mid;
        if (spread < ctx.L.gapMinSpread) continue;
        const suggested = roundTo5(mid);
        const overshoot = round2(sum(past.map((x) => Math.max(0, x - suggested))) / past.length);
        if (overshoot <= 0) continue;
        const scope = { start: ctx.history[0].start, end: ctx.history[ctx.history.length - 1].end };
        out.push(make(ctx, 'budget_gap', category, {
            category,
            params: { category, median: round2(mid), suggestedBudget: suggested, lowest: round2(Math.min(...past)), highest: round2(Math.max(...past)), periods: past.length, averageOver: overshoot },
            monthlySaving: overshoot,
            confidence: past.length >= 3 ? 0.5 : 0.4,
            scope,
            evidence: top(flexible.filter((r) => r.category === category && inRange(r, scope))),
            action: { type: 'set_budget', category, amount: suggested },
        }));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Many small purchases at one merchant
// ---------------------------------------------------------------------------
function merchantFrequency(ctx, recurringKeys) {
    if (!ctx.current || tooEarly(ctx)) return [];
    const weeks = Math.max(1, ctx.elapsed / 7);
    const by = new Map();
    for (const r of ctx.rows) {
        if (r.cls !== 'flexible' || r.trip || !r.key || r.amount <= 0 || !inRange(r, ctx.current) || recurringKeys.has(r.key)) continue;
        if (!by.has(r.key)) by.set(r.key, []);
        by.get(r.key).push(r);
    }
    const out = [];
    for (const [key, list] of by) {
        const count = list.length;
        const total = round2(sum(list.map((r) => r.amount)));
        const average = round2(total / count);
        const perWeek = count / weeks;
        if (count < ctx.L.frequencyMinCount || perWeek < ctx.L.frequencyMinPerWeek || average > ctx.L.frequencyMaxTicket) continue;
        const saving = round2((average * 52) / 12); // one fewer visit a week
        const before = ctx.history.length ? ctx.rows.filter((r) => r.key === key && inRange(r, ctx.cut(ctx.history[ctx.history.length - 1]))).length : 0;
        out.push(make(ctx, 'merchant_frequency', key, {
            merchant: key, merchantName: list[0].name, category: list[0].category,
            params: { name: list[0].name, count, total, average, perWeek: Math.round(perWeek * 10) / 10, days: ctx.elapsed, previousCount: before, weeklySaving: average },
            monthlySaving: Math.min(saving, total),
            confidence: before >= ctx.L.frequencyMinCount ? 0.65 : 0.5,
            evidence: top(list),
            action: { type: 'open_filter', merchant: key },
        }));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Cheaper store: comparable unit prices when receipts have items, otherwise the average basket per visit
// ---------------------------------------------------------------------------
function cheaperStore(ctx) {
    const end = ctx.until;
    const scope = { start: addDays(end, -(ctx.L.storeWindowDays - 1)), end };
    const visits = ctx.rows.filter((r) => r.category === 'Groceries' && !r.trip && r.key && r.amount > 0 && inRange(r, scope));
    if (visits.length === 0) return [];
    const total = sum(visits.map((r) => r.amount));
    const withItems = visits.filter((r) => normalizeItems(r.tx.lineItems, r.tx.category).some((it) => it.amount !== null));
    const coveragePct = total > 0 ? Math.round((sum(withItems.map((r) => r.amount)) / total) * 100) : 0;
    const months = ctx.L.storeWindowDays / 30;

    // 1. same product, comparable unit, different stores
    const products = new Map();
    for (const r of withItems) {
        for (const it of normalizeItems(r.tx.lineItems, r.tx.category)) {
            const up = unitPriceOf(it);
            const q = baseQuantityOf(it);
            const pk = productKey(it.name);
            if (!up || !q || !pk) continue;
            const p = products.get(pk) || { name: it.name, families: new Set(), base: up.base, stores: new Map() };
            p.families.add(up.family);
            const s = p.stores.get(r.key) || { name: r.name, priceSum: 0, n: 0, qty: 0, ids: [] };
            s.priceSum += up.value;
            s.n += 1;
            s.qty += q.qty;
            s.ids.push(r.id);
            p.stores.set(r.key, s);
            products.set(pk, p);
        }
    }
    const pairs = new Map();
    for (const p of products.values()) {
        if (p.families.size !== 1 || p.stores.size < 2) continue; // kg and litre prices are never mixed
        const stores = [...p.stores.entries()].map(([key, s]) => ({ key, name: s.name, price: s.priceSum / s.n, qty: s.qty, ids: s.ids })).sort((a, b) => a.price - b.price);
        const cheap = stores[0];
        for (const s of stores.slice(1)) {
            const diff = s.price - cheap.price;
            if (diff < 0.01) continue;
            const id = `${s.key}>${cheap.key}`;
            const pair = pairs.get(id) || { pricier: s, cheaper: cheap, saving: 0, examples: [], ids: new Set() };
            pair.saving += diff * s.qty;
            pair.examples.push({ name: p.name, base: p.base, cheaperPrice: round2(cheap.price), pricierPrice: round2(s.price) });
            [...s.ids, ...cheap.ids].forEach((x) => pair.ids.add(x));
            pairs.set(id, pair);
        }
    }
    const best = [...pairs.values()].filter((p) => p.examples.length >= 2).sort((a, b) => b.saving - a.saving)[0];
    if (best && best.saving / months >= 1) {
        const monthly = round2(best.saving / months);
        return [make(ctx, 'cheaper_store', `${best.pricier.key}>${best.cheaper.key}`, {
            merchant: best.pricier.key, merchantName: best.pricier.name, category: 'Groceries',
            params: { basis: 'items', cheaper: best.cheaper.name, pricier: best.pricier.name, products: best.examples.length, examples: best.examples.slice(0, 3), days: ctx.L.storeWindowDays, coveragePct, receipts: visits.length, receiptsWithItems: withItems.length },
            monthlySaving: monthly,
            confidence: best.examples.length >= 5 ? 0.7 : 0.55,
            scope,
            evidence: [...best.ids].slice(0, MAX_EVIDENCE),
            action: { type: 'open_filter', category: 'Groceries', merchant: best.pricier.key },
        })];
    }

    // 2. no comparable items: average basket per visit (says nothing about prices, and the card says so)
    const by = new Map();
    for (const r of visits) {
        const s = by.get(r.key) || { key: r.key, name: r.name, rows: [] };
        s.rows.push(r);
        by.set(r.key, s);
    }
    const stores = [...by.values()].filter((s) => s.rows.length >= ctx.L.storeMinVisits).map((s) => ({ ...s, visits: s.rows.length, total: round2(sum(s.rows.map((r) => r.amount))), average: round2(sum(s.rows.map((r) => r.amount)) / s.rows.length) })).sort((a, b) => a.average - b.average || a.key.localeCompare(b.key));
    if (stores.length < 2) return [];
    const cheap = stores[0];
    const dear = stores[stores.length - 1];
    const diff = round2(dear.average - cheap.average);
    if (diff < ctx.L.storeMinDiff) return [];
    return [make(ctx, 'cheaper_store', `${dear.key}>${cheap.key}`, {
        merchant: dear.key, merchantName: dear.name, category: 'Groceries',
        params: { basis: 'basket', cheaper: cheap.name, pricier: dear.name, cheaperAverage: cheap.average, pricierAverage: dear.average, difference: diff, cheaperVisits: cheap.visits, pricierVisits: dear.visits, days: ctx.L.storeWindowDays, coveragePct, receipts: visits.length, receiptsWithItems: withItems.length },
        monthlySaving: diff, // one shop a month moved to the cheaper store, same basket
        confidence: 0.25,
        scope,
        evidence: [...top(dear.rows, 4), ...top(cheap.rows, 4)],
        action: { type: 'open_filter', category: 'Groceries', merchant: dear.key },
    })];
}

// ---------------------------------------------------------------------------
// Debt: instalments and repayments are a commitment, not spending to cut
// ---------------------------------------------------------------------------
const INSTALMENT_RE = /(\d{1,2})\s*(?:\/|of|di|von|de|sur)\s*(\d{1,2})/i;

function debtCost(ctx, chains) {
    if (!ctx.current) return [];
    const debt = ctx.rows.filter((r) => r.cls === 'debt' && !r.trip && r.amount > 0);
    const mine = debt.filter((r) => inRange(r, ctx.current));
    const amount = round2(sum(mine.map((r) => r.amount)));
    if (amount <= 0) return [];
    const totals = monthTotals(ctx.txs, ctx.current, { trips: ctx.trips, accounts: ctx.accounts });
    let income = totals.income;
    let incomeBasis = 'period';
    if (!(income > 0)) {
        const past = ctx.history.map((r) => monthTotals(ctx.txs, r, { trips: ctx.trips, accounts: ctx.accounts }).income).filter((x) => x > 0);
        income = past.length ? round2(median(past)) : 0;
        incomeBasis = past.length ? 'typical' : 'none';
    }
    const typical = ctx.history.length ? round2(median(ctx.history.map((r) => sum(debt.filter((x) => inRange(x, r)).map((x) => x.amount))))) : null;
    // an end date only when the pattern shows one: "2/3" in the name or note, or a recurring end date
    let endsOn = null;
    let instalment = 0;
    for (const c of chains.filter((x) => x.cls === 'debt')) {
        instalment += c.amount;
        const tx = c.last.tx;
        const hint = INSTALMENT_RE.exec(`${tx.merchant || ''} ${tx.notes || ''}`);
        let end = tx.recurringData?.endDate ? dateKey(tx.recurringData.endDate) : null;
        if (!end && hint && Number(hint[2]) >= Number(hint[1]) && Number(hint[2]) <= 48) end = addDays(c.lastDate, (Number(hint[2]) - Number(hint[1])) * 30);
        if (end && (!endsOn || end > endsOn)) endsOn = end;
        else if (!end) endsOn = endsOn || null;
    }
    const allKnown = chains.filter((x) => x.cls === 'debt').every((c) => c.last.tx.recurringData?.endDate || INSTALMENT_RE.test(`${c.last.tx.merchant || ''} ${c.last.tx.notes || ''}`));
    if (!allKnown) endsOn = null;
    const groupIds = [...new Set(mine.map((r) => r.tx.groupId).filter(Boolean))];
    const categories = [...new Set(mine.map((r) => r.category))];
    const merchants = [...new Set(mine.map((r) => r.key))];
    const filter = groupIds.length === 1 && mine.every((r) => r.tx.groupId === groupIds[0]) ? { groupId: groupIds[0] } : categories.length === 1 ? { category: categories[0] } : merchants.length === 1 ? { merchant: merchants[0] } : {};
    const incomePct = income > 0 ? Math.round((amount / income) * 100) : null;
    return [make(ctx, 'debt_cost', 'all', {
        category: categories.length === 1 ? categories[0] : null,
        params: { amount, count: mine.length, incomePct, income: income > 0 ? income : null, incomeBasis, typical, instalment: round2(instalment), endsOn, names: [...new Set(mine.map((r) => r.name))].slice(0, 3), running: ctx.running, elapsedDays: ctx.elapsed },
        monthlySaving: 0,
        confidence: 0.9,
        score: amount * 0.08 + (incomePct !== null && incomePct >= 10 ? 10 : 0) + (incomePct !== null && incomePct >= 20 ? 10 : 0),
        evidence: top(mine),
        action: { type: 'open_filter', ...filter },
    })];
}

// ---------------------------------------------------------------------------
// Uncategorised spending hides everything else
// ---------------------------------------------------------------------------
function blindSpot(ctx) {
    if (!ctx.current) return [];
    const mine = ctx.rows.filter((r) => !r.trip && inRange(r, ctx.current) && r.amount > 0);
    const total = round2(sum(mine.map((r) => r.amount)));
    const blind = mine.filter((r) => isUncategorisedName(r.category));
    const amount = round2(sum(blind.map((r) => r.amount)));
    if (total <= 0 || blind.length < ctx.L.blindSpotMinCount) return [];
    // "largest" among what can be chosen: rent, bills and debt are known, they do not hide anything
    const byCat = new Map();
    for (const r of mine) if (r.cls === 'flexible') byCat.set(isUncategorisedName(r.category) ? 'Other' : r.category, (byCat.get(isUncategorisedName(r.category) ? 'Other' : r.category) || 0) + r.amount);
    const largest = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (amount / total < ctx.L.blindSpotMinPct && largest !== 'Other') return [];
    const names = new Map();
    for (const r of blind) names.set(r.name, (names.get(r.name) || 0) + r.amount);
    return [make(ctx, 'uncategorised_blind_spot', 'all', {
        category: 'Other',
        params: { amount, total, pct: Math.round((amount / total) * 100), count: blind.length, isLargest: largest === 'Other', names: [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n), running: ctx.running },
        monthlySaving: 0,
        confidence: 0.95,
        score: amount * 0.1,
        evidence: top(blind),
        action: { type: 'categorise' },
    })];
}

// ---------------------------------------------------------------------------
// Goal: what the best saving would do for it
// ---------------------------------------------------------------------------
function goalBoost(ctx, source) {
    if (!source || !(source.monthlySaving > 0)) return [];
    const balances = accountBalances(ctx.accounts, ctx.txs);
    const rows = (ctx.goals || [])
        .filter((g) => g && !g.isArchived && Number(g.targetAmount) > 0)
        .map((g) => {
            const saved = goalProgress(g, ctx.txs, balances);
            const remaining = round2(Number(g.targetAmount) - saved);
            const pace = goalMonthlyPace(g, ctx.txs, ctx.period);
            const monthsNow = pace > 0 ? Math.ceil(remaining / pace) : null;
            const monthsWith = Math.ceil(remaining / (pace + source.monthlySaving));
            return { g, saved, remaining, pace, monthsNow, monthsWith, sooner: monthsNow === null ? null : monthsNow - monthsWith };
        })
        .filter((r) => r.remaining > 0 && (r.sooner === null || r.sooner >= 1))
        .sort((a, b) => (b.sooner ?? 999) - (a.sooner ?? 999) || a.remaining - b.remaining);
    const best = rows[0];
    if (!best) return [];
    return [make(ctx, 'goal_boost', String(best.g.id), {
        params: { goal: best.g.name, saving: source.monthlySaving, remaining: best.remaining, pace: best.pace, monthsNow: best.monthsNow, monthsWith: best.monthsWith, sooner: best.sooner, sourceKind: source.kind, sourceCategory: source.category, sourceName: source.merchantName },
        monthlySaving: 0,
        confidence: source.confidence,
        score: source.score * 0.6,
        scope: source.scope,
        evidence: [],
        action: { type: 'add_goal', goalId: best.g.id, amount: source.monthlySaving },
    })];
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------
/** Highest score first; one card per subject (a merchant or a category), at most two of a kind. */
function rank(list, limit) {
    const sorted = [...list].sort((a, b) => b.score - a.score || b.monthlySaving - a.monthlySaving || a.id.localeCompare(b.id));
    const perKind = new Map();
    const subjects = new Set();
    const out = [];
    for (const o of sorted) {
        const subject = o.kind === 'goal_boost' || o.kind === 'debt_cost' || o.kind === 'uncategorised_blind_spot' ? o.key : o.merchant ? `m:${o.merchant}` : `c:${o.category}`;
        if (subjects.has(subject) || (perKind.get(o.kind) || 0) >= MAX_PER_KIND) continue;
        subjects.add(subject);
        perKind.set(o.kind, (perKind.get(o.kind) || 0) + 1);
        out.push(o);
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * computeOpportunities({ transactions, budgets, goals, accounts, trips, groups, period, today, dismissed, limit })
 * -> { top (at most 5, ranked by saving x confidence), all (every opportunity found), dismissed (found but hidden by "Not useful") }
 * `period` is a month key or a period object; `dismissed` is { [key]: 'YYYY-MM-DD' }.
 */
export function computeOpportunities(input = {}) {
    const { dismissed = {}, limit = MAX_SHOWN, today = new Date() } = input;
    const ctx = buildContext({ ...input, today });
    if (!ctx.range || ctx.progress.state === 'future' || ctx.rows.length === 0) return { top: [], all: [], dismissed: [] };
    const { out: recurring, chains } = recurringOpportunities(ctx);
    const recurringKeys = new Set(chains.map((c) => c.key));
    const above = categoryAboveBaseline(ctx);
    const raw = [
        ...above,
        ...merchantFrequency(ctx, recurringKeys),
        // a rise replaces the plain review of the same subscription
        ...recurring.filter((o) => !(o.kind === 'subscription_review' && recurring.some((x) => x.kind === 'price_creep' && x.merchant === o.merchant))),
        ...cheaperStore(ctx),
        ...budgetGap(ctx, new Set(above.map((o) => o.category))),
        ...debtCost(ctx, chains),
        ...blindSpot(ctx),
    ];
    // one opportunity per key (a merchant can have two chains): the stronger one stays
    const byKey = new Map();
    for (const o of raw) if (!byKey.has(o.key) || byKey.get(o.key).score < o.score) byKey.set(o.key, o);
    const found = [...byKey.values()];
    const visible = found.filter((o) => !isDismissed(o.key, dismissed, today));
    const source = [...visible].filter((o) => o.monthlySaving > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0];
    const boost = goalBoost(ctx, source);
    const all = [...found, ...boost];
    const hidden = all.filter((o) => isDismissed(o.key, dismissed, today));
    return { top: rank(all.filter((o) => !hidden.includes(o)), limit), all: [...all].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)), dismissed: hidden };
}

/** The saving the shown cards add up to (cards without a saving count as 0). */
export const totalMonthlySaving = (list = []) => round2(sum(list.map((o) => o.monthlySaving || 0)));

/**
 * What the model receives for an opportunity: numbers and names only, under a short id (O1, O2, ...). No transaction ids.
 * The same order as the cards, so the answer can be matched back by position.
 */
export function toModelOpportunities(list = []) {
    return list.map((o, i) => ({
        id: `O${i + 1}`,
        oppKind: o.kind,
        category: o.category,
        merchant: o.merchantName,
        monthlySaving: o.monthlySaving,
        yearlySaving: o.yearlySaving,
        confidence: o.level,
        action: o.action?.type || null,
        periodStart: o.scope?.start || null,
        periodEnd: o.scope?.end || null,
        ...o.params,
    }));
}

/** Dismissed suggestions as the model sees them: what kind and about what, nothing else. */
export const toModelDismissed = (list = []) => list.map((o) => ({ oppKind: o.kind, category: o.category, merchant: o.merchantName }));
