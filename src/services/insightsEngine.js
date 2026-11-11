// Deterministic insights engine (plan P6-T1). Pure: same input -> same output, no I/O, no clock
// (pass `today`). Every finding is { id, type, severity, title, body, amount, category, merchant,
// link, i18nKey, params }. `title`/`body` are English fallbacks; the UI should translate through
// `i18nKey` + `params` (keys are listed in INSIGHT_KEYS).
//
// severity: 'high' | 'medium' | 'low' | 'positive'. Ordering: severity, then amount (desc), then id.
import { displayName, merchantKey } from '../utils/merchant';
import { daysBetween, dateKey, monthKey } from '../utils/monthMath';
import { inPeriod, periodEnd, periodKey, periodProgress, periodSpecOf, previousPeriods } from '../utils/period';
import { isPlanned, monthTotals, round2, shareAmount, spentByCategory, typeOf } from '../utils/money';
import { WHOLE_MONTH, categoryBudgets } from '../utils/budgetMath';

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
};

export const INSIGHT_KEYS = [
    'insight.category_up',
    'insight.category_down',
    'insight.budget_over',
    'insight.budget_pace',
    'insight.unusual_transaction',
    'insight.subscription',
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
            title: up ? `${category} is up ${params.pct}%` : `${category} is down ${params.pct}%`,
            body: `${category} is ${fmt(value)} this month against a 3-month average of ${fmt(avg)} (${up ? '+' : '-'}${fmt(diff)}).`,
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
        const label = row.category === WHOLE_MONTH ? 'Monthly budget' : `${row.category} budget`;
        const category = row.category === WHOLE_MONTH ? null : row.category;
        if (row.status === 'over') {
            const over = row.spent - row.amount;
            out.push({
                id: `budget_over:${row.category}:${periodKey(month)}`,
                type: 'budget_over',
                severity: 'high',
                title: `${label} exceeded`,
                body: `You spent ${fmt(row.spent)} of ${fmt(row.amount)}, ${fmt(over)} over.`,
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
                title: `${label} on track to be exceeded`,
                body: `At this pace you will spend about ${fmt(row.projected)} of ${fmt(row.amount)}. To stay on budget, keep to ${fmt(row.perDayToStay)} a day.`,
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
            title: `Unusually large ${cat} payment`,
            body: `${name} on ${dateKey(tx.date)}: ${fmt(amount)}, against a typical ${fmt(m)} for ${cat}.`,
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

function subscriptionFindings(ctx) {
    const { transactions, month, fmt, t } = ctx;
    const prevPeriod = previousPeriods(month, 1)[0];
    return detectSubscriptions(transactions, { until: periodEnd(month), thresholds: t })
        .filter((s) => inPeriod(s.lastDate, month) || inPeriod(s.lastDate, prevPeriod))
        .map((s) => ({
            id: `subscription:${s.key}:${periodKey(month)}`,
            type: 'subscription',
            severity: 'low',
            title: `${s.name} looks like a subscription`,
            body: `${s.name} charged about ${fmt(s.amount)} ${s.count} months in a row and is not marked as recurring. That is ${fmt(s.amount * 12)} a year.`,
            amount: s.amount,
            category: null,
            merchant: s.key,
            link: activityLink(month, { merchant: s.key }),
            i18nKey: 'insight.subscription',
            params: { name: s.name, amount: s.amount, count: s.count, yearly: round2(s.amount * 12) },
        }));
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
            title: up ? 'You are saving more than usual' : cur.savingsRate < 0 ? 'You took money out of savings' : 'You are saving less than usual',
            body: `Savings rate is ${pct(cur.savingsRate)}% this month against ${pct(avgRate)}% on average (${fmt(cur.saved)} saved of ${fmt(cur.income)} income).`,
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
            title: `${top[1].name} is ${pct}% of your spending`,
            body: `${fmt(top[1].total)} of ${fmt(total)} this month went to ${top[1].name} (${top[1].count} payment${top[1].count === 1 ? '' : 's'}).`,
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
            title: 'No income logged this month',
            body: `You logged ${fmt(totals.spent)} of spending but no income, so savings rate and safe-to-spend may be off.`,
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
            title: `${list.length} transactions have no category`,
            body: `${list.length} payments (${fmt(amount)}) are uncategorised, which makes the category insights less reliable.`,
            amount,
            category: null,
            merchant: null,
            link: activityLink(month, { category: 'uncategorised' }),
            i18nKey: 'insight.uncategorised',
            params: { count: list.length, amount },
        },
    ];
}

/**
 * computeInsights({ transactions, budgets, goals, accounts, trips, month, today, currency, thresholds })
 * -> findings sorted by severity (high first), then amount (desc), then id.
 */
export function computeInsights({ transactions = [], budgets = [], goals = [], accounts = [], trips = [], month, today = new Date(), currency = 'EUR', thresholds = {} } = {}) {
    const m = month || monthKey(today);
    const ctx = {
        transactions: (transactions || []).filter(Boolean),
        budgets,
        goals,
        accounts,
        trips,
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
    ];
    return findings.sort(
        (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.amount ?? 0) - (a.amount ?? 0) || a.id.localeCompare(b.id)
    );
}
