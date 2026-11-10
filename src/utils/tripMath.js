// Trip (travel session) math (plan D15 / P4-T7). Pure.
import { addDays, dateKey, daysBetween } from './monthMath';
import { isPlanned, round2, shareAmount, fullAmount, typeOf } from './money';

const isTrip = (g) => g && g.kind === 'trip';

/**
 * activeTrip(trips, today): the trip new transactions attach to, or null.
 * A trip is active when it is manually started (isActive) or `today` falls inside startsOn..endsOn.
 * A manual start wins over dates; among equals the most recently started trip wins.
 */
export function activeTrip(trips = [], today = new Date()) {
    const day = dateKey(today);
    const candidates = (trips || []).filter(isTrip).filter((t) => {
        if (t.isActive) return true;
        const start = t.startsOn ? dateKey(t.startsOn) : '';
        const end = t.endsOn ? dateKey(t.endsOn) : '';
        return Boolean(start) && start <= day && (!end || day <= end);
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
        if (Boolean(b.isActive) !== Boolean(a.isActive)) return Boolean(b.isActive) - Boolean(a.isActive);
        return String(b.startsOn || '').localeCompare(String(a.startsOn || ''));
    });
    return candidates[0];
}

/**
 * tripTotals(trip, transactions, { today })
 * -> { total, perDay, daysElapsed, days, yourShare, byCategory, budget, remaining, budgetPct, count }
 *
 *  total       sum of the trip's expenses minus incomes/refunds booked to it (base currency)
 *  yourShare   the same with splits applied (only your part)
 *  days        trip length in days (null while the end date is unknown)
 *  daysElapsed days since the start up to today / the end date (>= 1 once started)
 *  perDay      total / daysElapsed
 *  byCategory  [{ category, total }] expenses only, largest first
 * Planned (unpaid) items are left out.
 */
export function tripTotals(trip, transactions = [], { today = new Date() } = {}) {
    const mine = (transactions || []).filter((tx) => tx && trip && tx.groupId === trip.id && !isPlanned(tx) && typeOf(tx) !== 'transfer');

    let total = 0;
    let yourShare = 0;
    const cats = new Map();
    let firstDate = '';
    for (const tx of mine) {
        const date = dateKey(tx.date);
        if (date && (!firstDate || date < firstDate)) firstDate = date;
        if (typeOf(tx) === 'income') {
            total -= fullAmount(tx);
            yourShare -= shareAmount(tx);
        } else {
            total += fullAmount(tx);
            yourShare += shareAmount(tx);
            const cat = tx.category || 'Other';
            cats.set(cat, (cats.get(cat) || 0) + fullAmount(tx));
        }
    }

    const start = trip?.startsOn ? dateKey(trip.startsOn) : firstDate;
    const end = trip?.endsOn ? dateKey(trip.endsOn) : '';
    const todayKey = dateKey(today);
    const days = start && end ? daysBetween(start, end) + 1 : null;
    let daysElapsed = 0;
    if (start && start <= todayKey) {
        const upTo = end && end < todayKey ? end : todayKey;
        daysElapsed = daysBetween(start, upTo) + 1;
    }
    const perDay = total / Math.max(daysElapsed, 1);

    const budget = trip?.budgetAmount ? Number(trip.budgetAmount) : null;
    return {
        total: round2(total),
        perDay: round2(perDay),
        daysElapsed,
        days,
        yourShare: round2(yourShare),
        byCategory: [...cats.entries()].map(([category, t]) => ({ category, total: round2(t) })).sort((a, b) => b.total - a.total),
        budget,
        remaining: budget ? round2(budget - total) : null,
        budgetPct: budget ? (total / budget) * 100 : null,
        count: mine.length,
    };
}

/** Does a transaction dated `date` fall inside the trip's date range (inclusive)? Used for CSV import attach. */
export function tripContainsDate(trip, date) {
    if (!trip || !trip.startsOn) return false;
    const d = dateKey(date);
    const start = dateKey(trip.startsOn);
    const end = trip.endsOn ? dateKey(trip.endsOn) : addDays(start, 3650);
    return Boolean(d) && start <= d && d <= end;
}
