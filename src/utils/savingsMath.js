// Savings and goal maths (plan P4-T1 / P4-T4). Pure.
import { addMonths, monthsBetween } from './monthMath';
import { inPeriod, anchorMonth, previousPeriods } from './period';
import { fullAmount, isPlanned, monthTotals, round2, typeOf } from './money';

/**
 * savingsOverview(transactions, month, { trips, accounts })
 * -> { saved, income, savingsRate, avgSaved, avgRate, months }
 * avg* cover the (up to) 3 months before `month` that have any income or saving; null when there are none.
 */
export function savingsOverview(transactions = [], month, { trips = [], accounts = [] } = {}) {
    const now = monthTotals(transactions, month, { trips, accounts });
    const past = previousPeriods(month, 3)
        .map((m) => monthTotals(transactions, m, { trips, accounts }))
        .filter((t) => t.income > 0 || t.saved !== 0);
    const avgSaved = past.length ? round2(past.reduce((s, t) => s + t.saved, 0) / past.length) : null;
    const incomeSum = past.reduce((s, t) => s + t.income, 0);
    const avgRate = past.length && incomeSum > 0 ? round2(past.reduce((s, t) => s + t.saved, 0) / incomeSum) : null;
    return { saved: now.saved, income: now.income, savingsRate: now.savingsRate, avgSaved, avgRate, months: past.length };
}

/** Average monthly contribution to a goal over the last 3 months plus the current one (transfers carrying its id). */
export function goalMonthlyPace(goal, transactions = [], month) {
    const window = [...previousPeriods(month, 3), month]; // months or pay cycles: "per month" then means per period
    const idx = (tx) => window.findIndex((p) => inPeriod(tx.date, p));
    const tagged = (transactions || []).filter((tx) => tx && !isPlanned(tx) && typeOf(tx) === 'transfer' && tx.goalId === goal.id && idx(tx) >= 0);
    if (tagged.length === 0) return 0;
    const first = Math.min(...tagged.map(idx));
    const span = Math.min(4, Math.max(1, window.length - first));
    return round2(tagged.reduce((s, tx) => s + fullAmount(tx), 0) / span);
}

/**
 * goalStatus({ goal, saved, pace, month })
 * -> { target, saved, remaining, pct (0-100), done, monthsToTarget, reachedMonth, neededPerMonth, targetMonth }
 *   monthsToTarget  months until saved reaches the target at `pace` per month (null when pace is 0)
 *   neededPerMonth  what the target date asks per month (null without a date, or when the date has passed / goal done)
 */
export function goalStatus({ goal, saved = 0, pace = 0, month: periodOrMonth }) {
    const month = typeof periodOrMonth === 'string' ? periodOrMonth : anchorMonth(periodOrMonth);
    const target = Number(goal?.targetAmount) || 0;
    const remaining = Math.max(0, round2(target - saved));
    const done = target > 0 && remaining === 0;
    const monthsToTarget = done ? 0 : pace > 0 ? Math.ceil(remaining / pace) : null;
    const targetMonth = goal?.targetDate ? String(goal.targetDate).slice(0, 7) : null;
    const left = targetMonth ? monthsBetween(month, targetMonth) : null;
    return {
        target,
        saved: round2(saved),
        remaining,
        pct: target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : 0,
        done,
        monthsToTarget,
        reachedMonth: monthsToTarget && monthsToTarget > 0 ? addMonths(month, monthsToTarget) : null,
        neededPerMonth: !done && targetMonth && left > 0 ? round2(remaining / left) : null,
        targetMonth,
    };
}

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
