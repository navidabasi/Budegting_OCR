// Privacy-safe aggregates sent to /api/insights and /api/chat (plan P6-T1).
// Contains totals, category sums, merchants as { key, name } only, budgets, goals, savings series,
// recurring charges and the engine's findings. NEVER contains notes, raw bank descriptions, line items,
// receipt images or transaction ids.
import { displayName, merchantKey } from '../utils/merchant';
import { dateKey, monthKey } from '../utils/monthMath';
import { anchorMonth, inPeriod, periodEnd, periodKey, periodProgress, previousPeriods, toRange } from '../utils/period';
import { addDays, safeToSpendPerDay } from '../utils/monthMath';
import { accountBalances, isPlanned, monthTotals, round2, shareAmount, spentByCategory, typeOf, fullAmount } from '../utils/money';
import { WHOLE_MONTH, categoryBudgets } from '../utils/budgetMath';
import { hashObject } from '../utils/stableHash';
import { computeInsights, detectSubscriptions } from './insightsEngine';

import { toModelDismissed, toModelOpportunities } from './savingsOpportunities';
import { toModelPatterns } from './patternInsights';
import { goalProgress } from '../utils/savingsMath';

export const AGGREGATE_VERSION = 2; // v2 (pass 3): findings with ids, opportunities, dismissed suggestions, verdict figures; + patterns (assistant v2)
export const MAX_PATTERNS_SENT = 3;
export const MAX_FINDINGS_SENT = 12;
export { hashObject };

const MONTHS_OF_HISTORY = 12; // chat gets 12 months; the insights prompt uses the last 6

export { goalProgress }; // lives in utils/savingsMath.js; re-exported for the screens that import it from here

function goalsSummary(goals, transactions, balances, periodOrMonth, today) {
    const progress = periodProgress(periodOrMonth, today);
    const month = typeof periodOrMonth === 'string' ? periodOrMonth : anchorMonth(periodOrMonth);
    return (goals || [])
        .filter((g) => g && !g.isArchived)
        .map((g) => {
            const target = Number(g.targetAmount) || 0;
            const saved = goalProgress(g, transactions, balances);
            const remaining = Math.max(0, round2(target - saved));
            let monthsLeft = null;
            if (g.targetDate) {
                const t = String(g.targetDate).slice(0, 7);
                monthsLeft = Math.max(0, (Number(t.slice(0, 4)) - Number(month.slice(0, 4))) * 12 + (Number(t.slice(5, 7)) - Number(month.slice(5, 7))));
            }
            return {
                name: g.name,
                target: round2(target),
                saved,
                remaining,
                pct: target > 0 ? Math.round((saved / target) * 100) : null,
                targetDate: g.targetDate ? String(g.targetDate).slice(0, 10) : null,
                neededPerMonth: monthsLeft && monthsLeft > 0 ? round2(remaining / monthsLeft) : null,
                asOfDay: progress.day,
            };
        });
}

/**
 * The three figures of the verdict strip, computed here so the model never has to:
 *   spent / spentBefore  this period against the same point of the previous one (the same elapsed days while the period runs,
 *                        the whole period once it is over); `spentBefore` is null when there is no earlier period on record
 *   saved                moved into savings minus moved out
 *   safePerDay           what can still be spent per day: from the whole-period budget when there is one, else from the income
 *                        logged for the period, after what is spent and still to pay; null for a closed period or without either
 */
export function verdictFigures({ transactions = [], budgets = [], accounts = [], trips = [], period, today = new Date() } = {}) {
    const txs = (transactions || []).filter(Boolean);
    const range = toRange(period);
    const progress = periodProgress(period, today);
    if (!range) return null;
    const running = progress.state === 'current';
    const cut = (r) => (running ? { start: r.start, end: addDays(r.start, progress.day - 1) < r.end ? addDays(r.start, progress.day - 1) : r.end } : r);
    const totals = monthTotals(txs, period, { trips, accounts });
    const prev = toRange(previousPeriods(period, 1)[0]);
    const first = txs.map((t) => dateKey(t.date)).filter(Boolean).sort()[0];
    const comparable = prev && first && first <= prev.end && txs.some((t) => inPeriod(t.date, prev));
    const spent = monthTotals(txs, cut(range), { trips, accounts }).spent;
    const spentBefore = comparable ? monthTotals(txs, cut(prev), { trips, accounts }).spent : null;
    const whole = categoryBudgets(budgets, txs, period, trips, { today, accounts }).find((r) => r.category === WHOLE_MONTH);
    let safePerDay = null;
    let safeBasis = null;
    if (running && whole) {
        safePerDay = safeToSpendPerDay({ budget: whole.amount, spent: totals.spent, upcoming: totals.upcoming, progress });
        safeBasis = 'budget';
    } else if (running && totals.income > 0) {
        safePerDay = Math.max(0, totals.income - totals.spent - totals.upcoming - Math.max(0, totals.saved)) / progress.daysLeft;
        safeBasis = 'income';
    }
    return {
        basis: running ? 'elapsed' : 'completed',
        elapsedDays: running ? progress.day : progress.days,
        totalDays: progress.days,
        daysLeft: progress.daysLeft,
        spent,
        spentBefore,
        change: spentBefore === null ? null : round2(spent - spentBefore),
        changePct: spentBefore ? Math.round(((spent - spentBefore) / spentBefore) * 100) : null,
        saved: totals.saved,
        income: totals.income,
        upcoming: totals.upcoming,
        safePerDay: safePerDay === null ? null : round2(safePerDay),
        safeBasis,
        periodEnd: periodEnd(period),
    };
}

const numbersOnly = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'number'));

/** N1.. -> finding id and O1.. -> opportunity key, for the same lists the aggregates were built from (stays on the device). */
export function buildRefMap(findings = [], opportunities = []) {
    const out = {};
    findings.slice(0, MAX_FINDINGS_SENT).forEach((f, i) => (out[`N${i + 1}`] = f.id));
    opportunities.forEach((o, i) => (out[`O${i + 1}`] = o.key));
    return out;
}

/**
 * buildAggregates({ transactions, budgets, goals, accounts, trips, groups, month, today, currency, opportunities, dismissed })
 *   opportunities  the cards shown (computeOpportunities().top); sent as numbers and names only (toModelOpportunities)
 *   dismissed      suggestions the owner marked "Not useful" (computeOpportunities().dismissed): kind and subject only
 *   patterns       the habits shown under "Your patterns" (computePatterns().top): kind, figures and dates, ids P1.. (assistant v2, B-T4)
 * -> plain JSON-safe object; stable for the same inputs (see hashAggregates).
 */
export function buildAggregates({ transactions = [], budgets = [], goals = [], accounts = [], trips = [], groups = [], month, today = new Date(), currency = 'EUR', opportunities = [], dismissed = [], patterns = [] } = {}) {
    // `month` is a calendar-month key or a period object (pay cycle, custom range); series are per period of the same kind
    const P = month || monthKey(today);
    const m = typeof P !== 'string' && P.kind === 'range' ? P.start.slice(0, 7) : periodKey(P); // the API wants a YYYY-MM; the exact dates are in `period`
    const txs = (transactions || []).filter(Boolean);
    const progress = periodProgress(P, today);
    const range = toRange(P);
    const periods = [...previousPeriods(P, MONTHS_OF_HISTORY - 1), P];

    const categoriesByMonth = {};
    const savingsSeries = [];
    for (const p of periods) {
        const mk = periodKey(p);
        categoriesByMonth[mk] = spentByCategory(txs, p, { trips, includeTrips: true });
        const t = monthTotals(txs, p, { trips, accounts });
        savingsSeries.push({ month: mk, income: t.income, spent: t.spent, saved: t.saved, savingsRate: t.savingsRate });
    }

    // Top merchants of the month by merchantKey (+ display name). Raw descriptions never leave.
    const byMerchant = new Map();
    for (const tx of txs) {
        if (typeOf(tx) !== 'expense' || isPlanned(tx) || !inPeriod(tx.date, P)) continue;
        const key = tx.merchantKey || merchantKey(tx.merchant);
        if (!key) continue;
        const e = byMerchant.get(key) || { key, name: displayName(tx.merchant) || key, total: 0, count: 0 };
        e.total += shareAmount(tx);
        e.count += 1;
        byMerchant.set(key, e);
    }
    const topMerchants = [...byMerchant.values()]
        .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
        .slice(0, 10)
        .map((e) => ({ key: e.key, name: e.name, total: round2(e.total), count: e.count }));

    const budgetRows = categoryBudgets(budgets, txs, P, trips, { today, accounts }).map((r) => ({
        category: r.category === '*' ? 'Total' : r.category,
        budget: r.amount,
        spent: r.spent,
        status: r.status,
        projected: r.projected,
        pacePct: Math.round(r.pacePct),
    }));

    const balances = accountBalances(accounts, txs);
    const recurring = detectSubscriptions(txs, { until: dateKey(today) })
        .slice(0, 10)
        .map((s) => ({ key: s.key, name: s.name, amount: s.amount, months: s.count }));

    const findings = computeInsights({ transactions: txs, budgets, goals, accounts, trips, groups, month: P, today, currency })
        .slice(0, MAX_FINDINGS_SENT)
        .map((f, i) => ({
            id: `N${i + 1}`,
            type: f.type,
            severity: f.severity,
            title: f.title,
            body: f.body,
            amount: f.amount,
            category: f.category,
            merchant: f.merchant,
            figures: numbersOnly(f.params),
        }));

    return {
        version: AGGREGATE_VERSION,
        month: m,
        // what `month` means: a calendar month, a salary-to-salary cycle or a custom range, with its exact dates
        period: { kind: typeof P === 'string' ? 'month' : P.kind, start: range?.start || null, end: range?.end || null },
        currency,
        dayOfMonth: progress.day,
        daysInMonth: progress.days,
        monthState: progress.state,
        summary: monthTotals(txs, P, { trips, accounts }),
        categoriesByMonth,
        savingsSeries,
        topMerchants,
        budgets: budgetRows,
        goals: goalsSummary(goals, txs, balances, P, today),
        trips: (trips || [])
            .filter((t) => t && t.kind === 'trip')
            .slice(0, 5)
            .map((t) => ({ name: t.name, startsOn: t.startsOn || null, endsOn: t.endsOn || null, budget: t.budgetAmount ?? null })),
        recurring,
        findings,
        verdict: verdictFigures({ transactions: txs, budgets, accounts, trips, period: P, today }),
        opportunities: toModelOpportunities(opportunities),
        dismissed: toModelDismissed(dismissed),
        patterns: toModelPatterns(patterns.slice(0, MAX_PATTERNS_SENT)).map((x, i) => ({ id: `P${i + 1}`, ...x })),
    };
}

/**
 * Stable hash of an aggregate object (+ optional extras such as the language) for the insights cache.
 * Values that only move with the clock (day of month, pace, projections, derived findings) are left out,
 * so the cache is invalidated by new data, not by the passage of a day.
 */
export function hashAggregates(aggregates, extra = {}) {
    const { dayOfMonth, findings, verdict, opportunities, patterns, ...core } = aggregates || {};
    void dayOfMonth;
    void verdict;
    const stripped = {
        ...core,
        // which findings and suggestions there are decides whether a summary is still current; their day-to-day figures do not
        findings: (findings || []).map((f) => [f.type, f.category || null, f.merchant || null]),
        opportunities: (opportunities || []).map((o) => [o.oppKind, o.category || null, o.merchant || null]),
        patterns: (patterns || []).map((x) => [x.patternKind, x.category || null, x.merchant || null]),
        budgets: (core.budgets || []).map(({ category, budget, spent }) => ({ category, budget, spent })),
        goals: (core.goals || []).map(({ asOfDay, ...g }) => {
            void asOfDay;
            return g;
        }),
    };
    return hashObject({ a: stripped, x: extra });
}
