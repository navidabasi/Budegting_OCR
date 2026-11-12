// Deterministic insights engine (plan P6-T1). Pure: same input -> same output, no I/O, no clock
// (pass `today`). Every finding is { id, type, severity, title, body, amount, category, merchant,
// link, i18nKey, params }. `title`/`body` are English fallbacks; the UI should translate through
// `i18nKey` + `params` (keys are listed in INSIGHT_KEYS).
//
// severity: 'high' | 'medium' | 'low' | 'positive'. Ordering: severity, then amount (desc), then id.
import { displayName, merchantKey } from '../utils/merchant';
import { addDays, daysBetween, dateKey, monthKey } from '../utils/monthMath';
import { inPeriod, periodEnd, periodKey, periodProgress, periodSpecOf, previousPeriods, toRange } from '../utils/period';
import { excludedTripIds, isPlanned, monthTotals, round2, shareAmount, spentByCategory, typeOf } from '../utils/money';
import { WHOLE_MONTH, activeBudgets, categoryBudgets } from '../utils/budgetMath';
import { spendClass } from '../utils/spendClass';

export const THRESHOLDS = {
    categoryChangePct: 0.25,
    categoryChangeMinAmount: 20,
    categoryChangeHighPct: 0.5,
    categoryChangeHighAmount: 50,
    unusualSigma: 2,
    unusualMinSamples: 5,
    unusualLookbackMonths: 6,
    unusualMaxFindings: 3,
    subscriptionAmountTolerance: 0.05,
    subscriptionGapDays: [27, 33],
    subscriptionMinCount: 2,
    savingsRateDelta: 0.1,
    savingsMinDayOfMonth: 20,
    topMerchantShare: 0.3,
    topMerchantMinSpent: 100,
    noIncomeMinSpent: 100,
    noIncomeMinDay: 5,
    uncategorisedMin: 5,
    fixedShareMinSpent: 100,
    streakMinPeriods: 2,
    streakLookback: 6,
    weekendMinDays: 14,
    weekendRatio: 1.5,
    weekendMinExtra: 20,
    squeezeMinSpent: 100,
    squeezeRatio: 0.5,
    squeezeMinPeriods: 2,
};

export const INSIGHT_KEYS = [
    'insight.category_up',
    'insight.category_down',
    'insight.budget_over',
    'insight.budget_pace',
    'insight.unusual_transaction',
    'insight.subscription',
    'insight.fixed_cost',
    'insight.fixed_vs_flexible',
    'insight.income_vs_spend',
    'insight.income_vs_spend_over',
    'insight.income_vs_spend_done',
    'insight.streak',
    'insight.weekend_spike',
    'insight.end_of_cycle_squeeze',
    'insight.savings_rate_down',
    'insight.savings_rate_up',
    'insight.top_merchant',
    'insight.no_income',
    'insight.uncategorised',
];

const SEVERITY_RANK = { high: 0, medium: 1, low: 2, positive: 3 };

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const stdev = (xs) => {
    const m = mean(xs);
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};
const keyOf = (tx) => tx.merchantKey || merchantKey(tx.merchant);
const isExpense = (tx) => tx && typeOf(tx) === 'expense' && !isPlanned(tx);
const isUncategorised = (tx) => !tx.category || String(tx.category).toLowerCase() === 'other';

function makeFormat(currency) {
    const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : `${currency} `;
    return (n) => `${symbol}${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
}

const activityLink = (month, extra = {}) => ({ screen: 'activity', params: { m: periodSpecOf(month), ...extra } });
const budgetsLink = (month, extra = {}) => ({ screen: 'budgets', params: { m: periodSpecOf(month), ...extra } });

// ---- rule 1: category change vs 3-month average ----------------------------------------
function categoryChanges(ctx) {
    const { transactions, trips, month, progress, fmt, t } = ctx;
    const cur = spentByCategory(transactions, month, { trips, includeTrips: false });
    const prev = previousPeriods(month, 3).map((m) => spentByCategory(transactions, m, { trips, includeTrips: false }));
    const categories = new Set([...Object.keys(cur), ...prev.flatMap((p) => Object.keys(p))]);
    const out = [];
    for (const category of categories) {
        const series = prev.map((p) => p[category] || 0);
        const first = series.findIndex((v) => v > 0);
        if (first === -1) continue;
        const avg = mean(series.slice(first));
        if (avg <= 0) continue;
        const value = cur[category] || 0;
        const diff = value - avg;
        if (progress.state === 'current' && diff < 0) continue; // month not finished: cannot call a drop
        const pct = diff / avg;
        if (Math.abs(diff) < t.categoryChangeMinAmount || Math.abs(pct) < t.categoryChangePct) continue;
        const up = diff > 0;
        const params = { category, amount: round2(Math.abs(diff)), pct: Math.round(Math.abs(pct) * 100), current: round2(value), average: round2(avg) };
        out.push({
            id: `category_${up ? 'up' : 'down'}:${category}:${periodKey(month)}`,
            type: up ? 'category_up' : 'category_down',
            severity: up ? (pct >= t.categoryChangeHighPct && diff >= t.categoryChangeHighAmount ? 'high' : 'medium') : 'positive',
            title: up ? `${fmt(diff)} more on ${category} than usual` : `${fmt(diff)} less on ${category} than usual`,
            body: `${fmt(value)} this period against your usual ${fmt(avg)} (the average of your last 3 periods), ${params.pct}% ${up ? 'more' : 'less'}.`,
            amount: params.amount,
            category,
            merchant: null,
            link: activityLink(month, { category }),
            i18nKey: up ? 'insight.category_up' : 'insight.category_down',
            params,
        });
    }
    return out;
}

// ---- rule 2: budget pace / over --------------------------------------------------------
function budgetFindings(ctx) {
    const { transactions, budgets, trips, accounts, month, today, progress, fmt } = ctx;
    const out = [];
    for (const row of categoryBudgets(budgets, transactions, month, trips, { today, accounts })) {
        const label = row.category === WHOLE_MONTH ? 'Whole month' : row.category;
        const category = row.category === WHOLE_MONTH ? null : row.category;
        if (row.status === 'over') {
            const over = row.spent - row.amount;
            out.push({
                id: `budget_over:${row.category}:${periodKey(month)}`,
                type: 'budget_over',
                severity: 'high',
                title: `${fmt(over)} over budget: ${label}`,
                body: `${fmt(row.spent)} spent of ${fmt(row.amount)}.`,
                amount: round2(over),
                category,
                merchant: null,
                link: budgetsLink(month, category ? { category } : {}),
                i18nKey: 'insight.budget_over',
                params: { label, category, spent: row.spent, budget: row.amount, over: round2(over) },
            });
        } else if (row.status === 'warning' && progress.state === 'current' && row.projected > row.amount) {
            const over = row.projected - row.amount;
            out.push({
                id: `budget_pace:${row.category}:${periodKey(month)}`,
                type: 'budget_pace',
                severity: 'medium',
                title: `${label}: heading for ${fmt(row.projected)} of ${fmt(row.amount)}`,
                body: `${fmt(row.spent)} spent so far. Keeping to ${fmt(row.perDayToStay)} a day keeps you inside the budget.`,
                amount: round2(over),
                category,
                merchant: null,
                link: budgetsLink(month, category ? { category } : {}),
                i18nKey: 'insight.budget_pace',
                params: { label, category, spent: row.spent, budget: row.amount, projected: row.projected, perDay: round2(row.perDayToStay) },
            });
        }
    }
    return out;
}

// ---- rule 3: unusual transaction (> mean + 2 sigma, >= 5 samples) ----------------------
function unusualTransactions(ctx) {
    const { transactions, trips, month, fmt, t } = ctx;
    const tripIds = new Set((trips || []).filter((g) => g && g.kind === 'trip').map((g) => g.id));
    const lookback = previousPeriods(month, t.unusualLookbackMonths);
    const samples = new Map();
    for (const tx of transactions) {
        if (!isExpense(tx) || (tx.groupId && tripIds.has(tx.groupId))) continue;
        if (!lookback.some((p) => inPeriod(tx.date, p))) continue;
        const cat = tx.category || 'Other';
        if (!samples.has(cat)) samples.set(cat, []);
        samples.get(cat).push(shareAmount(tx));
    }
    const found = [];
    for (const tx of transactions) {
        if (!isExpense(tx) || !inPeriod(tx.date, month) || (tx.groupId && tripIds.has(tx.groupId))) continue;
        const cat = tx.category || 'Other';
        const xs = samples.get(cat);
        if (!xs || xs.length < t.unusualMinSamples) continue;
        const m = mean(xs);
        const sd = stdev(xs);
        const amount = shareAmount(tx);
        if (amount > m + t.unusualSigma * sd && amount >= 1.5 * m) {
            found.push({ tx, amount, m, cat });
        }
    }
    found.sort((a, b) => b.amount - a.amount || String(a.tx.id).localeCompare(String(b.tx.id)));
    return found.slice(0, t.unusualMaxFindings).map(({ tx, amount, m, cat }) => {
        const key = keyOf(tx);
        const name = displayName(tx.merchant) || key || cat;
        return {
            id: `unusual_transaction:${tx.id}`,
            type: 'unusual_transaction',
            severity: 'medium',
            title: `${fmt(amount)} at ${name}: larger than usual`,
            body: `A typical ${cat} payment is ${fmt(m)}. This one was on ${dateKey(tx.date)}.`,
            amount: round2(amount),
            category: cat,
            merchant: key || null,
            link: { screen: 'transaction', params: { id: tx.id } },
            i18nKey: 'insight.unusual_transaction',
            params: { name, category: cat, amount: round2(amount), typical: round2(m), date: dateKey(tx.date) },
        };
    });
}

// ---- rule 4: subscription-like charges that are not marked recurring --------------------
/** Chains of same-merchant, same-amount (+-5 %) charges about a month apart (27-33 days). Exported for the aggregates. */
export function detectSubscriptions(transactions, { until, thresholds = THRESHOLDS } = {}) {
    const [minGap, maxGap] = thresholds.subscriptionGapDays;
    const byKey = new Map();
    for (const tx of transactions) {
        if (!isExpense(tx)) continue;
        const key = keyOf(tx);
        if (!key) continue;
        const date = dateKey(tx.date);
        if (!date || (until && date > until)) continue;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push({ tx, date, amount: shareAmount(tx) });
    }
    const chains = [];
    for (const [key, list] of byKey) {
        list.sort((a, b) => a.date.localeCompare(b.date) || String(a.tx.id).localeCompare(String(b.tx.id)));
        const open = [];
        for (const item of list) {
            const chain = open.find((c) => {
                const last = c[c.length - 1];
                const gap = daysBetween(last.date, item.date);
                return gap >= minGap && gap <= maxGap && Math.abs(item.amount - last.amount) <= thresholds.subscriptionAmountTolerance * last.amount;
            });
            if (chain) chain.push(item);
            else open.push([item]);
        }
        for (const c of open) {
            if (c.length >= thresholds.subscriptionMinCount && !c.some((i) => i.tx.recurringData)) {
                chains.push({ key, name: displayName(c[c.length - 1].tx.merchant) || key, count: c.length, amount: round2(c[c.length - 1].amount), lastDate: c[c.length - 1].date });
            }
        }
    }
    return chains.sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
}

/**
 * Rent, housing, utilities and insurance repeat too, but they are fixed costs, never "subscriptions": the finding only suggests
 * marking them recurring. Instalments and repayments (Klarna, loans, friends) are debt and are not reported here at all.
 */
function subscriptionFindings(ctx) {
    const { transactions, month, fmt, t } = ctx;
    const prevPeriod = previousPeriods(month, 1)[0];
    const classOf = new Map();
    for (const tx of transactions) if (isExpense(tx)) classOf.set(keyOf(tx), spendClass(tx, ctx.lookups));
    return detectSubscriptions(transactions, { until: periodEnd(month), thresholds: t })
        .filter((s) => inPeriod(s.lastDate, month) || inPeriod(s.lastDate, prevPeriod))
        .filter((s) => classOf.get(s.key) === 'flexible' || classOf.get(s.key) === 'fixed')
        .map((s) => {
            const fixed = classOf.get(s.key) === 'fixed';
            return {
                id: `${fixed ? 'fixed_cost' : 'subscription'}:${s.key}:${periodKey(month)}`,
                type: fixed ? 'fixed_cost' : 'subscription',
                severity: 'low',
                title: fixed ? `${fmt(s.amount)} a month for ${s.name}` : `${fmt(s.amount)} a month to ${s.name}`,
                body: fixed
                    ? `A fixed cost, paid ${s.count} months in a row. Mark it as recurring and it shows up in your upcoming bills.`
                    : `Charged ${s.count} months in a row, ${fmt(s.amount * 12)} a year. Worth a look if you still use it.`,
                amount: s.amount,
                category: null,
                merchant: s.key,
                link: { screen: 'activity', params: { m: 'all', merchant: s.key } },
                i18nKey: fixed ? 'insight.fixed_cost' : 'insight.subscription',
                params: { name: s.name, amount: s.amount, count: s.count, yearly: round2(s.amount * 12) },
            };
        });
}

// ---- rule 5: savings rate vs average ---------------------------------------------------
function savingsRate(ctx) {
    const { transactions, trips, accounts, month, progress, fmt, t } = ctx;
    if (progress.state === 'future') return [];
    if (progress.state === 'current' && progress.day < t.savingsMinDayOfMonth) return [];
    const cur = monthTotals(transactions, month, { trips, accounts });
    if (cur.savingsRate === null) return [];
    const prev = previousPeriods(month, 3).map((m) => monthTotals(transactions, m, { trips, accounts })).filter((x) => x.savingsRate !== null);
    if (prev.length === 0) return [];
    const avgRate = mean(prev.map((x) => x.savingsRate));
    const avgSaved = mean(prev.map((x) => x.saved));
    const delta = cur.savingsRate - avgRate;
    if (Math.abs(delta) < t.savingsRateDelta) return [];
    const up = delta > 0;
    const pct = (v) => Math.round(v * 100);
    return [
        {
            id: `savings_rate_${up ? 'up' : 'down'}:${periodKey(month)}`,
            type: up ? 'savings_rate_up' : 'savings_rate_down',
            severity: up ? 'positive' : cur.savingsRate < 0 ? 'high' : 'medium',
            title: `${pct(cur.savingsRate)}% of income saved, ${up ? 'above' : 'below'} your usual ${pct(avgRate)}%`,
            body: `${fmt(cur.saved)} saved of ${fmt(cur.income)} income this period.`,
            amount: round2(Math.abs(cur.saved - avgSaved)),
            category: null,
            merchant: null,
            link: { screen: 'savings', params: { m: periodSpecOf(month) } },
            i18nKey: up ? 'insight.savings_rate_up' : 'insight.savings_rate_down',
            params: { rate: pct(cur.savingsRate), averageRate: pct(avgRate), saved: cur.saved, income: cur.income },
        },
    ];
}

// ---- rule 6: top merchant share > 30 % ---------------------------------------------------
function topMerchant(ctx) {
    const { transactions, trips, accounts, month, fmt, t } = ctx;
    const total = monthTotals(transactions, month, { trips, accounts }).spent;
    if (total < t.topMerchantMinSpent) return [];
    const by = new Map();
    for (const tx of transactions) {
        if (!isExpense(tx) || !inPeriod(tx.date, month)) continue;
        const key = keyOf(tx);
        if (!key) continue;
        const e = by.get(key) || { total: 0, name: displayName(tx.merchant) || key, count: 0 };
        e.total += shareAmount(tx);
        e.count += 1;
        by.set(key, e);
    }
    const top = [...by.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))[0];
    if (!top) return [];
    const share = top[1].total / total;
    if (share <= t.topMerchantShare) return [];
    const pct = Math.round(share * 100);
    return [
        {
            id: `top_merchant:${top[0]}:${periodKey(month)}`,
            type: 'top_merchant',
            severity: 'low',
            title: `${pct}% of spending went to ${top[1].name}`,
            body: `${fmt(top[1].total)} of ${fmt(total)} in ${top[1].count} payment${top[1].count === 1 ? '' : 's'}.`,
            amount: round2(top[1].total),
            category: null,
            merchant: top[0],
            link: activityLink(month, { merchant: top[0] }),
            i18nKey: 'insight.top_merchant',
            params: { name: top[1].name, pct, amount: round2(top[1].total), total: round2(total), count: top[1].count },
        },
    ];
}

// ---- rule 7: no income logged ------------------------------------------------------------
function noIncome(ctx) {
    const { transactions, trips, accounts, month, progress, fmt, t } = ctx;
    if (progress.state === 'future') return [];
    if (progress.state === 'current' && progress.day < t.noIncomeMinDay) return [];
    const totals = monthTotals(transactions, month, { trips, accounts });
    if (totals.income > 0 || totals.spent < t.noIncomeMinSpent) return [];
    return [
        {
            id: `no_income:${periodKey(month)}`,
            type: 'no_income',
            severity: 'low',
            title: 'No income logged yet',
            body: `${fmt(totals.spent)} of spending is logged but no income, so savings and what is left cannot be judged.`,
            amount: totals.spent,
            category: null,
            merchant: null,
            link: activityLink(month, { type: 'income' }),
            i18nKey: 'insight.no_income',
            params: { spent: totals.spent },
        },
    ];
}

// ---- rule 8: uncategorised ---------------------------------------------------------------
function uncategorised(ctx) {
    const { transactions, month, fmt, t } = ctx;
    const list = transactions.filter((tx) => isExpense(tx) && inPeriod(tx.date, month) && isUncategorised(tx));
    if (list.length < t.uncategorisedMin) return [];
    const amount = round2(list.reduce((s, tx) => s + shareAmount(tx), 0));
    return [
        {
            id: `uncategorised:${periodKey(month)}`,
            type: 'uncategorised',
            severity: 'low',
            title: `${list.length} payments have no category`,
            body: `${fmt(amount)} is uncategorised. Giving them a category makes every other insight more accurate.`,
            amount,
            category: null,
            merchant: null,
            link: activityLink(month, { category: 'uncategorised' }),
            i18nKey: 'insight.uncategorised',
            params: { count: list.length, amount },
        },
    ];
}

// ---- shared by the pass 3 rules ------------------------------------------------------------
/** Paid expenses of a date range with their class (fixed / debt / savings / flexible); trip spending is flagged. */
function classRows(ctx, range) {
    const tripIds = excludedTripIds(ctx.trips);
    const out = [];
    for (const tx of ctx.transactions) {
        if (!isExpense(tx) || !inPeriod(tx.date, range)) continue;
        out.push({ date: dateKey(tx.date), amount: shareAmount(tx), cls: spendClass(tx, ctx.lookups), trip: !!(tx.groupId && tripIds.has(tx.groupId)) });
    }
    return out;
}
/** Earlier periods in which the owner was already recording (a period before the first transaction is not "zero spending"). */
function recordedHistory(ctx, n) {
    const first = ctx.transactions.map((tx) => dateKey(tx.date)).filter(Boolean).sort()[0];
    return previousPeriods(ctx.month, n).filter((p) => first && periodEnd(p) >= first && ctx.transactions.some((tx) => inPeriod(tx.date, p)));
}
const total = (rows) => rows.reduce((s, r) => s + r.amount, 0);
const isWeekend = (date) => {
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return dow === 0 || dow === 6;
};

// ---- rule 9: how much of the spending is fixed ----------------------------------------------
function fixedVsFlexible(ctx) {
    const { month, fmt, t } = ctx;
    const rows = classRows(ctx, month);
    const all = round2(total(rows));
    const fixed = round2(total(rows.filter((r) => r.cls === 'fixed')));
    if (all < t.fixedShareMinSpent || fixed <= 0) return [];
    const flexible = round2(total(rows.filter((r) => r.cls === 'flexible')));
    const pct = Math.round((fixed / all) * 100);
    return [
        {
            id: `fixed_vs_flexible:${periodKey(month)}`,
            type: 'fixed_vs_flexible',
            severity: 'low',
            title: `${pct}% of spending is fixed costs`,
            body: `${fmt(fixed)} of ${fmt(all)} went to rent, bills and insurance. ${fmt(flexible)} is what you can actually steer.`,
            amount: fixed,
            category: null,
            merchant: null,
            link: { screen: 'breakdown', params: { m: periodSpecOf(month) } },
            i18nKey: 'insight.fixed_vs_flexible',
            params: { pct, fixed, flexible, total: all },
        },
    ];
}

// ---- rule 10: income against spending: what is left for the rest of the period ------------------
function incomeVsSpend(ctx) {
    const { transactions, trips, accounts, month, progress, fmt } = ctx;
    if (progress.state === 'future') return [];
    const totals = monthTotals(transactions, month, { trips, accounts });
    if (!(totals.income > 0)) return [];
    const left = round2(totals.income - totals.spent - totals.upcoming);
    const running = progress.state === 'current';
    const params = { income: totals.income, spent: totals.spent, upcoming: totals.upcoming, left: Math.abs(left), days: progress.daysLeft, perDay: running && left > 0 ? round2(left / progress.daysLeft) : 0 };
    const base = { amount: Math.abs(left), category: null, merchant: null, link: activityLink(month), params };
    if (left < 0) {
        return [{ ...base, id: `income_vs_spend_over:${periodKey(month)}`, type: 'income_vs_spend_over', severity: running ? 'medium' : 'high', title: `${fmt(left)} more spent than came in`, body: `${fmt(totals.income)} came in; ${fmt(totals.spent)} went out and ${fmt(totals.upcoming)} is still to pay.`, i18nKey: 'insight.income_vs_spend_over' }];
    }
    if (!running) {
        return [{ ...base, id: `income_vs_spend_done:${periodKey(month)}`, type: 'income_vs_spend_done', severity: 'positive', title: `${fmt(left)} left at the end`, body: `${fmt(totals.income)} came in and ${fmt(totals.spent)} went out.`, i18nKey: 'insight.income_vs_spend_done' }];
    }
    return [{ ...base, id: `income_vs_spend:${periodKey(month)}`, type: 'income_vs_spend', severity: 'low', title: `${fmt(left)} left for ${progress.daysLeft} days`, body: `${fmt(totals.income)} came in, ${fmt(totals.spent)} is spent and ${fmt(totals.upcoming)} is still to pay. That is ${fmt(params.perDay)} a day.`, i18nKey: 'insight.income_vs_spend' }];
}

// ---- rule 11: budgets kept several periods in a row (a win) ---------------------------------------
function streaks(ctx) {
    const { transactions, budgets, trips, accounts, month, progress, fmt, t } = ctx;
    const periods = [...recordedHistory(ctx, t.streakLookback), ...(progress.state === 'past' ? [month] : [])];
    if (periods.length < t.streakMinPeriods) return [];
    const out = [];
    for (const b of activeBudgets(budgets, month)) {
        let count = 0;
        for (let i = periods.length - 1; i >= 0; i--) {
            const p = periods[i];
            const row = activeBudgets(budgets, p).find((x) => x.category === b.category);
            if (!row) break;
            const spent = b.category === WHOLE_MONTH ? monthTotals(transactions, p, { trips, accounts }).spent : spentByCategory(transactions, p, { trips, includeTrips: false })[b.category] || 0;
            if (spent > Number(row.amount)) break;
            count += 1;
        }
        if (count < t.streakMinPeriods) continue;
        const category = b.category === WHOLE_MONTH ? null : b.category;
        const label = category || 'Whole month';
        out.push({
            id: `streak:${b.category}:${periodKey(month)}`,
            type: 'streak',
            severity: 'positive',
            title: `${label}: under budget ${count} periods in a row`,
            body: `Each of the last ${count} periods ended below the ${fmt(b.amount)} budget.`,
            amount: count,
            category,
            merchant: null,
            link: budgetsLink(month, category ? { category } : {}),
            i18nKey: 'insight.streak',
            params: { label, category, count, budget: Number(b.amount) },
        });
    }
    return out;
}

// ---- rule 12: weekends cost more per day than weekdays ---------------------------------------------
function weekendSpike(ctx) {
    const { month, progress, today, fmt, t } = ctx;
    const range = toRange(month);
    if (!range || progress.state === 'future' || progress.day < t.weekendMinDays) return [];
    const end = progress.state === 'current' ? dateKey(today) : range.end;
    const rows = classRows(ctx, { start: range.start, end }).filter((r) => r.cls === 'flexible' && !r.trip);
    let weekendDays = 0;
    let weekDays = 0;
    for (let d = range.start; d <= end; d = addDays(d, 1)) (isWeekend(d) ? (weekendDays += 1) : (weekDays += 1));
    if (!weekendDays || !weekDays) return [];
    const weekendTotal = total(rows.filter((r) => isWeekend(r.date)));
    const all = total(rows);
    const weekend = round2(weekendTotal / weekendDays);
    const weekday = round2((all - weekendTotal) / weekDays);
    if (weekend < weekday * t.weekendRatio || (weekend - weekday) * weekendDays < t.weekendMinExtra) return [];
    const pct = Math.round((weekendTotal / all) * 100);
    return [
        {
            id: `weekend_spike:${periodKey(month)}`,
            type: 'weekend_spike',
            severity: 'low',
            title: `${fmt(weekend)} a day at weekends, ${fmt(weekday)} on weekdays`,
            body: `${pct}% of this period's flexible spending fell on Saturdays and Sundays.`,
            amount: round2((weekend - weekday) * weekendDays),
            category: null,
            merchant: null,
            link: activityLink(month),
            i18nKey: 'insight.weekend_spike',
            params: { weekend, weekday, pct, weekendDays },
        },
    ];
}

// ---- rule 13: money gets tight in the last week of the period ----------------------------------------
function endOfCycleSqueeze(ctx) {
    const { month, fmt, t } = ctx;
    const periods = recordedHistory(ctx, 3);
    const squeezed = [];
    for (const p of periods) {
        const r = toRange(p);
        const cutoff = addDays(r.end, -6);
        if (cutoff <= r.start) continue;
        const rows = classRows(ctx, r).filter((x) => x.cls === 'flexible' && !x.trip);
        if (total(rows) < t.squeezeMinSpent) continue;
        const lastDaily = total(rows.filter((x) => x.date >= cutoff)) / 7;
        const earlierDaily = total(rows.filter((x) => x.date < cutoff)) / (daysBetween(r.start, cutoff) || 1);
        if (earlierDaily > 0 && lastDaily <= earlierDaily * t.squeezeRatio) squeezed.push({ lastDaily, earlierDaily });
    }
    if (squeezed.length < t.squeezeMinPeriods) return [];
    const mid = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const lastWeek = round2(mid(squeezed.map((x) => x.lastDaily)));
    const earlier = round2(mid(squeezed.map((x) => x.earlierDaily)));
    return [
        {
            id: `end_of_cycle_squeeze:${periodKey(month)}`,
            type: 'end_of_cycle_squeeze',
            severity: 'low',
            title: `The last week runs on ${fmt(lastWeek)} a day`,
            body: `In ${squeezed.length} of your last ${periods.length} periods, daily spending in the final week fell to less than half of the ${fmt(earlier)} a day before it. Spreading it more evenly avoids the squeeze.`,
            amount: round2((earlier - lastWeek) * 7),
            category: null,
            merchant: null,
            link: activityLink(month),
            i18nKey: 'insight.end_of_cycle_squeeze',
            params: { lastWeek, earlier, count: squeezed.length, periods: periods.length },
        },
    ];
}

/**
 * computeInsights({ transactions, budgets, goals, accounts, trips, groups, month, today, currency, thresholds })
 * -> findings sorted by severity (high first), then amount (desc), then id.
 */
export function computeInsights({ transactions = [], budgets = [], goals = [], accounts = [], trips = [], groups = [], month, today = new Date(), currency = 'EUR', thresholds = {} } = {}) {
    const m = month || monthKey(today);
    const ctx = {
        transactions: (transactions || []).filter(Boolean),
        budgets,
        goals,
        accounts,
        trips,
        lookups: { groups: [...(groups || []), ...(trips || [])], accounts },
        month: m,
        today,
        progress: periodProgress(m, today),
        fmt: makeFormat(currency),
        t: { ...THRESHOLDS, ...thresholds },
    };
    const findings = [
        ...categoryChanges(ctx),
        ...budgetFindings(ctx),
        ...unusualTransactions(ctx),
        ...subscriptionFindings(ctx),
        ...savingsRate(ctx),
        ...topMerchant(ctx),
        ...noIncome(ctx),
        ...uncategorised(ctx),
        ...fixedVsFlexible(ctx),
        ...incomeVsSpend(ctx),
        ...streaks(ctx),
        ...weekendSpike(ctx),
        ...endOfCycleSqueeze(ctx),
    ];
    return findings.sort(
        (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.amount ?? 0) - (a.amount ?? 0) || a.id.localeCompare(b.id)
    );
}
