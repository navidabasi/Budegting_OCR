// Privacy-safe aggregates sent to /api/insights and /api/chat (plan P6-T1).
// Contains totals, category sums, merchants as { key, name } only, budgets, goals, savings series,
// recurring charges and the engine's findings. NEVER contains notes, raw bank descriptions, line items,
// receipt images or transaction ids.
import { displayName, merchantKey } from '../utils/merchant';
import { dateKey, monthKey, monthProgress, previousMonths } from '../utils/monthMath';
import { accountBalances, isPlanned, monthTotals, round2, shareAmount, spentByCategory, typeOf, fullAmount } from '../utils/money';
import { categoryBudgets } from '../utils/budgetMath';
import { hashObject } from '../utils/stableHash';
import { computeInsights, detectSubscriptions } from './insightsEngine';

export const AGGREGATE_VERSION = 1;
export { hashObject };

const MONTHS_OF_HISTORY = 12; // chat gets 12 months; the insights prompt uses the last 6

/**
 * Goal progress: startingAmount + transfers carrying the goal's id; when no transfer uses the goal
 * and the goal points at an account, the account balance is used instead (plan section 4).
 */
export function goalProgress(goal, transactions = [], balances = []) {
    const tagged = (transactions || []).filter((tx) => tx && !isPlanned(tx) && typeOf(tx) === 'transfer' && tx.goalId === goal.id);
    const start = Number(goal.startingAmount) || 0;
    let saved;
    if (tagged.length > 0 || !goal.accountId) {
        saved = start + tagged.reduce((s, tx) => s + fullAmount(tx), 0);
    } else {
        saved = balances.find((b) => b.id === goal.accountId)?.balance ?? start;
    }
    return round2(saved);
}

function goalsSummary(goals, transactions, balances, month, today) {
    const progress = monthProgress(month, today);
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
 * buildAggregates({ transactions, budgets, goals, accounts, trips, month, today, currency })
 * -> plain JSON-safe object; stable for the same inputs (see hashAggregates).
 */
export function buildAggregates({ transactions = [], budgets = [], goals = [], accounts = [], trips = [], month, today = new Date(), currency = 'EUR' } = {}) {
    const m = month || monthKey(today);
    const txs = (transactions || []).filter(Boolean);
    const progress = monthProgress(m, today);
    const months = [...previousMonths(m, MONTHS_OF_HISTORY - 1), m];

    const categoriesByMonth = {};
    const savingsSeries = [];
    for (const mk of months) {
        categoriesByMonth[mk] = spentByCategory(txs, mk, { trips, includeTrips: true });
        const t = monthTotals(txs, mk, { trips, accounts });
        savingsSeries.push({ month: mk, income: t.income, spent: t.spent, saved: t.saved, savingsRate: t.savingsRate });
    }

    // Top merchants of the month by merchantKey (+ display name). Raw descriptions never leave.
    const byMerchant = new Map();
    for (const tx of txs) {
        if (typeOf(tx) !== 'expense' || isPlanned(tx) || monthKey(tx.date) !== m) continue;
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

    const budgetRows = categoryBudgets(budgets, txs, m, trips, { today, accounts }).map((r) => ({
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

    const findings = computeInsights({ transactions: txs, budgets, goals, accounts, trips, month: m, today, currency }).map((f) => ({
        type: f.type,
        severity: f.severity,
        title: f.title,
        body: f.body,
        amount: f.amount,
        category: f.category,
        merchant: f.merchant,
    }));

    return {
        version: AGGREGATE_VERSION,
        month: m,
        currency,
        dayOfMonth: progress.day,
        daysInMonth: progress.days,
        monthState: progress.state,
        summary: monthTotals(txs, m, { trips, accounts }),
        categoriesByMonth,
        savingsSeries,
        topMerchants,
        budgets: budgetRows,
        goals: goalsSummary(goals, txs, balances, m, today),
        trips: (trips || [])
            .filter((t) => t && t.kind === 'trip')
            .slice(0, 5)
            .map((t) => ({ name: t.name, startsOn: t.startsOn || null, endsOn: t.endsOn || null, budget: t.budgetAmount ?? null })),
        recurring,
        findings,
    };
}

/**
 * Stable hash of an aggregate object (+ optional extras such as the language) for the insights cache.
 * Values that only move with the clock (day of month, pace, projections, derived findings) are left out,
 * so the cache is invalidated by new data, not by the passage of a day.
 */
export function hashAggregates(aggregates, extra = {}) {
    const { dayOfMonth, findings, ...core } = aggregates || {};
    void dayOfMonth;
    void findings;
    const stripped = {
        ...core,
        budgets: (core.budgets || []).map(({ category, budget, spent }) => ({ category, budget, spent })),
        goals: (core.goals || []).map(({ asOfDay, ...g }) => {
            void asOfDay;
            return g;
        }),
    };
    return hashObject({ a: stripped, x: extra });
}
