// Budget math (plan P4-T3). Pure.
import { daysInMonth, monthEnd, monthProgress, monthStart, previousMonths, toYmd } from './monthMath';
import { monthTotals, round2, spentByCategory } from './money';

export const WHOLE_MONTH = '*';

/**
 * budgetStatus({ budget, spent, date })
 *   date: any day inside the budget month (usually today; use the month end for a closed month)
 * -> { remaining, spentPct, pacePct, projected, status: 'ok'|'warning'|'over', perDayToStay }
 *
 *   pacePct      how far through the month we are (the "pace tick")
 *   projected    linear end-of-month projection (spent / day * days)
 *   status       over: spent > budget; warning: spent >= 90 % of it, or (from day 5) the projection
 *                exceeds it; otherwise ok
 *   perDayToStay what you may still spend per day (today included) to end on budget; 0 when over
 */
export function budgetStatus({ budget, spent = 0, date = new Date() } = {}) {
    const amount = Number(budget);
    const used = Number(spent) || 0;
    const p = toYmd(date);
    const days = p ? daysInMonth(date) : 30;
    const day = p ? p.d : 1;
    const pacePct = (day / days) * 100;
    const projected = day > 0 ? (used / day) * days : used;

    if (!(amount > 0)) {
        return { remaining: null, spentPct: null, pacePct, projected: round2(projected), status: 'ok', perDayToStay: null };
    }

    const remaining = amount - used;
    const daysLeft = days - day + 1;
    let status = 'ok';
    if (used > amount) status = 'over';
    else if (used >= 0.9 * amount || (day >= 5 && projected > amount)) status = 'warning';

    return {
        remaining: round2(remaining),
        spentPct: (used / amount) * 100,
        pacePct,
        projected: round2(projected),
        status,
        perDayToStay: remaining > 0 ? remaining / daysLeft : 0,
    };
}

/** Budgets that apply to a month: latest row per category that started on/before it and has not ended. */
export function activeBudgets(budgets = [], month) {
    const start = monthStart(month);
    const best = new Map();
    for (const b of budgets || []) {
        if (!b || !b.category || !b.startsOn) continue;
        const startsOn = String(b.startsOn).slice(0, 10);
        if (startsOn > start) continue;
        if (b.endsOn && String(b.endsOn).slice(0, 10) < start) continue;
        const current = best.get(b.category);
        if (!current || startsOn > String(current.startsOn).slice(0, 10)) best.set(b.category, b);
    }
    return [...best.values()];
}

/**
 * categoryBudgets(budgets, transactions, month, trips, { today, accounts })
 * One row per active budget: { id, category, amount, currency, spent, ...budgetStatus }.
 * The whole-month budget ('*') counts everything including trip spend; category budgets leave out trips
 * that have excludeFromBudgets (the default). Sorted: whole month first, then by spent share desc.
 */
export function categoryBudgets(budgets = [], transactions = [], month, trips = [], { today = new Date(), accounts = [] } = {}) {
    const byCategory = spentByCategory(transactions, month, { trips, includeTrips: false });
    const wholeMonthSpent = monthTotals(transactions, month, { trips, accounts }).spent;
    const progress = monthProgress(month, today);
    const date = progress.state === 'past' ? monthEnd(month) : progress.state === 'future' ? monthStart(month) : today;

    const rows = activeBudgets(budgets, month).map((b) => {
        const spent = b.category === WHOLE_MONTH ? wholeMonthSpent : byCategory[b.category] || 0;
        return {
            id: b.id,
            category: b.category,
            amount: Number(b.amount),
            currency: b.currency,
            spent: round2(spent),
            ...budgetStatus({ budget: b.amount, spent, date }),
        };
    });
    return rows.sort((a, b) => {
        if (a.category === WHOLE_MONTH) return -1;
        if (b.category === WHOLE_MONTH) return 1;
        return (b.spentPct || 0) - (a.spentPct || 0);
    });
}

/**
 * copyForward(budgets, month): new budget rows (no id) for `month` carrying over each active budget that
 * has no row starting on that month yet.
 */
export function copyForward(budgets = [], month) {
    const start = monthStart(month);
    const hasThisMonth = new Set((budgets || []).filter((b) => b && String(b.startsOn).slice(0, 10) === start).map((b) => b.category));
    return activeBudgets(budgets, month)
        .filter((b) => !hasThisMonth.has(b.category) && String(b.startsOn).slice(0, 10) < start)
        .map((b) => ({ category: b.category, amount: Number(b.amount), currency: b.currency, startsOn: start, endsOn: null }));
}

/**
 * suggestBudget(transactions, category, month): average monthly spend over the (up to) 3 months before
 * `month`, counting from the first month with data; rounded to whole units. null when there is no history.
 * category '*' averages total spending. Trip spend is left out of category suggestions.
 */
export function suggestBudget(transactions = [], category, month, { trips = [], accounts = [] } = {}) {
    const months = previousMonths(month, 3);
    const totals = months.map((m) => {
        if (category === WHOLE_MONTH) return monthTotals(transactions, m, { trips, accounts }).spent;
        return spentByCategory(transactions, m, { trips, includeTrips: false })[category] || 0;
    });
    const firstWithData = totals.findIndex((t) => t > 0);
    if (firstWithData === -1) return null;
    const used = totals.slice(firstWithData);
    return Math.round(used.reduce((s, t) => s + t, 0) / used.length);
}
