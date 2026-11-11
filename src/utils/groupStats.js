// Groups (pass 3, workstream C): per-group totals for a period and all time, the per-category split, and the group to suggest for a
// merchant. Pure. A group is a `groups` row without kind 'trip'; trips are groups with kind 'trip' and are listed separately.
//
// Money: "out" is what left (expenses and transfers, full amount), "in" is income. Planned / unpaid records are counted but not
// added (they are not money yet), the same rule as every other total.
import { fullAmount, round2, typeOf } from './money';
import { inPeriod } from './period';
import { shouldIncludeInFinancialTotals } from './tracking';
import { merchantKey } from './merchant';

export const isTrip = (g) => g?.kind === 'trip';

/** { groups, trips }: plain groups pinned first then by name; trips newest first. */
export function splitGroups(all = []) {
    const groups = all.filter((g) => !isTrip(g)).sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    const trips = all.filter(isTrip).sort((a, b) => String(b.startsOn || b.createdAt || '').localeCompare(String(a.startsOn || a.createdAt || '')));
    return { groups, trips };
}

function add(acc, tx) {
    acc.count += 1;
    if (!shouldIncludeInFinancialTotals(tx)) return acc;
    const amount = fullAmount(tx);
    if (typeOf(tx) === 'income') acc.in += amount;
    else acc.out += amount;
    return acc;
}
const empty = () => ({ count: 0, out: 0, in: 0 });
const done = (acc) => ({ count: acc.count, out: round2(acc.out), in: round2(acc.in), net: round2(acc.in - acc.out) });

/** Totals of a list of transactions: { count, out, in, net }. */
export const totalsOf = (rows = []) => done(rows.reduce(add, empty()));

/**
 * One summary per group: { group, period: totals, all: totals, lastDate }. `period` may be null (then period = all).
 * Transactions are matched on groupId.
 */
export function groupSummaries(groups = [], transactions = [], period = null) {
    const byGroup = new Map(groups.map((g) => [g.id, { group: g, period: empty(), all: empty(), lastDate: '' }]));
    for (const tx of transactions) {
        const s = tx.groupId ? byGroup.get(tx.groupId) : null;
        if (!s) continue;
        add(s.all, tx);
        if (!period || inPeriod(tx.date, period)) add(s.period, tx);
        const d = String(tx.date || '').slice(0, 10);
        if (d > s.lastDate) s.lastDate = d;
    }
    return [...byGroup.values()].map((s) => ({ group: s.group, period: done(s.period), all: done(s.all), lastDate: s.lastDate }));
}

/**
 * Detail of one group: { rows (newest first), period, all, byCategory: [{ category, amount, share }] } where byCategory splits the money
 * out of the period (all time when period is null) by category, largest first, and share is a 0..1 fraction of that money.
 */
export function groupDetail(group, transactions = [], period = null) {
    const rows = transactions.filter((tx) => group && tx.groupId === group.id).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const inScope = period ? rows.filter((tx) => inPeriod(tx.date, period)) : rows;
    const cats = new Map();
    for (const tx of inScope) {
        if (!shouldIncludeInFinancialTotals(tx) || typeOf(tx) === 'income') continue;
        const key = typeOf(tx) === 'transfer' ? 'Transfer' : tx.category || 'Other';
        cats.set(key, (cats.get(key) || 0) + fullAmount(tx));
    }
    const outTotal = [...cats.values()].reduce((a, b) => a + b, 0);
    const byCategory = [...cats.entries()]
        .map(([category, amount]) => ({ category, amount: round2(amount), share: outTotal > 0 ? amount / outTotal : 0 }))
        .sort((a, b) => b.amount - a.amount);
    return { rows, periodRows: inScope, period: totalsOf(inScope), all: totalsOf(rows), byCategory };
}

/**
 * The group to suggest for a new record at `merchant`: the group of the most recent earlier transaction at the same merchant
 * (matched by merchant key), when that group still exists. Returns the group row or null.
 */
export function suggestGroupFor(merchant, transactions = [], groups = [], { excludeId = null } = {}) {
    const key = merchantKey(merchant);
    if (!key) return null;
    let best = null;
    for (const tx of transactions) {
        if (tx.id === excludeId || !tx.groupId) continue;
        if ((tx.merchantKey || merchantKey(tx.merchant)) !== key) continue;
        if (!best || String(tx.date) > String(best.date) || (tx.date === best.date && String(tx.createdAt || '') > String(best.createdAt || ''))) best = tx;
    }
    if (!best) return null;
    const g = groups.find((x) => x.id === best.groupId);
    return g && !isTrip(g) ? g : null;
}
