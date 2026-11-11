// Money math over transactions (camelCase records as in src/data/api.js). Pure.
//
// Conventions
//  - Amounts use `amountBase ?? total` (base currency, stored at write time).
//  - "Share" amounts honour split data like getEffectiveAmount(): you only count your part.
//  - Planned / unpaid items (trackingData.isTracked && status 'open') are not money yet: they are
//    excluded from totals and balances and reported as `upcoming`.
import { getEffectiveAmount } from './helpers';
import { shouldIncludeInFinancialTotals } from './tracking';
import { dateKey, daysInMonth, monthKey } from './monthMath';

export const SAVINGS_KINDS = ['savings', 'investment'];

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};

export const typeOf = (tx) => tx?.transactionType || 'expense';
export const isPlanned = (tx) => !shouldIncludeInFinancialTotals(tx);
export const isSavingsKind = (kind) => SAVINGS_KINDS.includes(kind);

/** Full amount of the transaction in base currency (falls back to the entered total). */
export function fullAmount(tx) {
    if (!tx) return 0;
    return tx.amountBase !== undefined && tx.amountBase !== null ? num(tx.amountBase) : num(tx.total);
}

/** Your share in base currency: full amount, or your part when the receipt is split. */
export function shareAmount(tx) {
    if (!tx) return 0;
    const total = num(tx.total);
    const effective = getEffectiveAmount(tx);
    if (tx.amountBase === undefined || tx.amountBase === null) return effective;
    if (!tx.splitData || total === 0) return num(tx.amountBase);
    return num(tx.amountBase) * (effective / total);
}

/** Your share of the receipt as a fraction of its full amount (1 when not split or when the amount is 0). */
export function shareFactor(tx) {
    const full = fullAmount(tx);
    return full === 0 ? 1 : shareAmount(tx) / full;
}

/** Your share factor for one item of a receipt. Equal to the receipt's factor until item-level splits exist (see splits.js). */
export function itemShareFactor(tx) {
    return shareFactor(tx);
}

/** Trips (group objects) whose spend is kept out of category budgets. */
export function excludedTripIds(trips = []) {
    return new Set(
        (trips || [])
            .filter((t) => t && t.id && (t.kind === undefined || t.kind === null || t.kind === 'trip') && t.excludeFromBudgets !== false)
            .map((t) => t.id)
    );
}

// ---------------------------------------------------------------------------------------
// Account balances
// ---------------------------------------------------------------------------------------

/** Amount that moves on a given account (its own currency when known, else the entered total). */
function movedAmount(tx, account) {
    const total = num(tx.total);
    if (account?.currency && tx.currency && account.currency !== tx.currency) {
        if (tx.amountBase !== undefined && tx.amountBase !== null && tx.baseCurrency === account.currency) return num(tx.amountBase);
    }
    return total;
}

/**
 * Balance per account: opening balance + income - expenses - transfers out + transfers in.
 * Only transactions dated on/after the account's openingDate count. Returns the accounts in
 * their original order with a `balance` field. Transactions without an account are ignored.
 *
 * Limitation: a transfer between accounts of different currencies moves the same number on
 * both sides (no FX leg is stored yet).
 */
export function accountBalances(accounts = [], transactions = []) {
    const byId = new Map();
    for (const a of accounts || []) {
        byId.set(a.id, { account: a, balance: num(a.openingBalance), since: a.openingDate ? dateKey(a.openingDate) : '' });
    }
    const touch = (id, delta, tx) => {
        const entry = byId.get(id);
        if (!entry) return;
        const date = dateKey(tx.date);
        if (entry.since && date && date < entry.since) return;
        entry.balance += delta;
    };
    for (const tx of transactions || []) {
        if (!tx || isPlanned(tx)) continue;
        const type = typeOf(tx);
        if (type === 'income') {
            touch(tx.accountId, movedAmount(tx, byId.get(tx.accountId)?.account), tx);
        } else if (type === 'transfer') {
            touch(tx.accountId, -movedAmount(tx, byId.get(tx.accountId)?.account), tx);
            if (tx.toAccountId) touch(tx.toAccountId, movedAmount(tx, byId.get(tx.toAccountId)?.account), tx);
        } else {
            touch(tx.accountId, -movedAmount(tx, byId.get(tx.accountId)?.account), tx);
        }
    }
    return (accounts || []).map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        currency: a.currency,
        isArchived: Boolean(a.isArchived),
        balance: round2(byId.get(a.id).balance),
    }));
}

/** Sum of balances, optionally limited to some kinds and a single currency. */
export function totalBalance(balances = [], { kinds, currency } = {}) {
    return round2(
        balances
            .filter((b) => !b.isArchived && (!kinds || kinds.includes(b.kind)) && (!currency || b.currency === currency))
            .reduce((s, b) => s + b.balance, 0)
    );
}

// ---------------------------------------------------------------------------------------
// Month totals
// ---------------------------------------------------------------------------------------

/**
 * monthTotals(transactions, 'YYYY-MM', { trips, accounts })
 *  -> { spent, income, saved, savingsRate, upcoming, travel, travelByTrip }
 *
 *  spent         expenses (your share), transfers excluded. Includes trip spend.
 *  income        income transactions
 *  saved         transfers into savings/investment accounts minus transfers back out of them.
 *                Needs `accounts` for the kinds; without them a transfer with a goalId counts as saved.
 *  savingsRate   saved / income, null when income is 0
 *  upcoming      planned/unpaid expenses dated in the month
 *  travel        expenses of trips with excludeFromBudgets (also inside `spent`)
 *  travelByTrip  [{ tripId, name, total }] for the "Travel (name)" lines
 */
export function monthTotals(transactions = [], month, { trips = [], accounts = [] } = {}) {
    const excluded = excludedTripIds(trips);
    const tripNames = new Map((trips || []).map((t) => [t.id, t.name]));
    const kinds = new Map((accounts || []).map((a) => [a.id, a.kind]));
    const perTrip = new Map();

    let spent = 0;
    let income = 0;
    let saved = 0;
    let upcoming = 0;
    let travel = 0;

    for (const tx of transactions || []) {
        if (!tx || monthKey(tx.date) !== month) continue;
        const type = typeOf(tx);
        const planned = isPlanned(tx);

        if (type === 'expense') {
            const amount = shareAmount(tx);
            if (planned) {
                upcoming += amount;
                continue;
            }
            spent += amount;
            if (tx.groupId && excluded.has(tx.groupId)) {
                travel += amount;
                perTrip.set(tx.groupId, (perTrip.get(tx.groupId) || 0) + amount);
            }
        } else if (type === 'income') {
            if (!planned) income += shareAmount(tx);
        } else if (type === 'transfer') {
            if (planned) continue;
            const amount = fullAmount(tx);
            const fromSavings = isSavingsKind(kinds.get(tx.accountId));
            const toSavings = isSavingsKind(kinds.get(tx.toAccountId));
            if (toSavings && !fromSavings) saved += amount;
            else if (fromSavings && !toSavings) saved -= amount;
            else if (!kinds.has(tx.toAccountId) && !fromSavings && tx.goalId) saved += amount;
        }
    }

    return {
        spent: round2(spent),
        income: round2(income),
        saved: round2(saved),
        savingsRate: income > 0 ? round2(saved / income) : null,
        upcoming: round2(upcoming),
        travel: round2(travel),
        travelByTrip: [...perTrip.entries()].map(([tripId, total]) => ({ tripId, name: tripNames.get(tripId) || '', total: round2(total) })),
    };
}

/** Spent per category for a month (expenses, your share). Trip spend can be left out. */
export function spentByCategory(transactions = [], month, { trips = [], includeTrips = true } = {}) {
    const excluded = excludedTripIds(trips);
    const out = {};
    for (const tx of transactions || []) {
        if (!tx || monthKey(tx.date) !== month || typeOf(tx) !== 'expense' || isPlanned(tx)) continue;
        if (!includeTrips && tx.groupId && excluded.has(tx.groupId)) continue;
        const cat = tx.category || 'Other';
        out[cat] = (out[cat] || 0) + shareAmount(tx);
    }
    for (const k of Object.keys(out)) out[k] = round2(out[k]);
    return out;
}

// ---------------------------------------------------------------------------------------
// Debt / receivable presentation and net worth
// ---------------------------------------------------------------------------------------

/** Balance as shown: a debt is always negative, a receivable ("owed to you") always positive, others as they are. */
export function displayBalance(b) {
    if (!b) return 0;
    if (b.kind === 'debt') return -Math.abs(b.balance);
    if (b.kind === 'receivable') return Math.abs(b.balance);
    return b.balance;
}

/** Net worth in one currency: every non-archived account by displayBalance (debts subtract, receivables add). */
export function netWorth(balances = [], { currency } = {}) {
    return round2(balances.filter((b) => !b.isArchived && (!currency || b.currency === currency)).reduce((s, b) => s + displayBalance(b), 0));
}

/**
 * cumulativeSpend(transactions, month, { trips, upToDay }) -> number[] (index 0 = day 1), the running total of
 * expenses (your share, trip spend included, planned/unpaid and transfers left out). Stops at `upToDay` when given.
 */
export function cumulativeSpend(transactions = [], month, { upToDay } = {}) {
    const days = daysInMonth(month);
    const last = Math.min(days, upToDay ?? days);
    const perDay = new Array(days).fill(0);
    for (const tx of transactions || []) {
        if (!tx || typeOf(tx) !== 'expense' || isPlanned(tx) || monthKey(tx.date) !== month) continue;
        const d = Number(dateKey(tx.date).slice(8, 10));
        if (d >= 1 && d <= days) perDay[d - 1] += shareAmount(tx);
    }
    const out = [];
    let run = 0;
    for (let i = 0; i < last; i++) {
        run += perDay[i];
        out.push(round2(run));
    }
    return out;
}
