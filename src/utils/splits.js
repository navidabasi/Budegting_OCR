// Shared expenses (pass 2, section 5). Pure; all money inside this module is integer cents, so shares always add up exactly.
//
// Split shape v2 (stored in the existing `splitData` jsonb, no schema change):
//   { v: 2, payer: 'me' | personId, participants: [{ id, name }], method: 'equal' | 'percent' | 'fixed' | 'items',
//     shares: { [id]: cents }, percents?: { [id]: number }, itemAllocations?: { [itemId]: { [id]: cents } },
//     unallocated?: { [id]: cents } }
// `me` is the owner's own id inside participants (absent when the owner only paid for others). Old shapes are read, not rewritten:
//   { method: 'equal', people, yourShare? }  and  { method: 'custom', users: [{ name, amount }] } (first user = me).
// A settlement is a transfer-type transaction whose splitData is { v: 2, kind: 'settlement', personId, direction: 'received' | 'paid', settles: [txId] }:
// it moves money between accounts and a person's balance, and is never spending or income.
//
// Rounding rule (shown to the user): when an amount cannot be divided exactly, the leftover cents go one each to the participants
// with the largest fractional remainder, ties by the order of the participants list (the owner first). The result is deterministic.
import { normalizeItems } from './receiptItems';
import { isUnconverted } from './baseCurrency';

export const ME = 'me';
export const toCents = (amount) => Math.round((Number(amount) || 0) * 100);
export const fromCents = (cents) => Math.round(cents) / 100;

/** Divide `total` cents by integer weights, largest remainder first. Returns { parts, extra: [indexes that got a leftover cent] }. */
export function distribute(total, weights) {
    const sign = total < 0 ? -1 : 1;
    const t = Math.abs(total);
    const w = weights.map((x) => Math.max(0, x));
    const sum = w.reduce((a, b) => a + b, 0);
    if (!w.length) return { parts: [], extra: [] };
    if (sum === 0) return distribute(total, w.map(() => 1));
    const base = w.map((x) => Math.floor((t * x) / sum));
    const frac = w.map((x, i) => (t * x) % sum === 0 ? 0 : (t * x) / sum - base[i]);
    let left = t - base.reduce((a, b) => a + b, 0);
    const order = frac.map((f, i) => ({ f, i })).sort((a, b) => b.f - a.f || a.i - b.i);
    const extra = [];
    for (const { i } of order) {
        if (left <= 0) break;
        base[i] += 1;
        extra.push(i);
        left -= 1;
    }
    return { parts: base.map((x) => x * sign), extra: extra.sort((a, b) => a - b) };
}

const sumOf = (obj) => Object.values(obj || {}).reduce((a, b) => a + b, 0);
const ids = (participants) => participants.map((p) => p.id);

/**
 * buildSplit({ total, method, participants, payer, percents, fixed, items, allocations })
 *  -> { ok, split, remainder: { cents, to: [ids] }, difference }
 * `fixed` is { id: amount }, `percents` { id: number }, `items` the receipt's line items and `allocations` { itemId: [ids that share it] }.
 * `difference` (cents) is what is missing (+) or over (-) for percent/fixed input that does not add up; `ok` is false then.
 */
export function buildSplit({ total, method = 'equal', participants, payer = ME, percents, fixed, items = [], allocations = {} }) {
    const totalCents = toCents(total);
    const order = ids(participants);
    const base = { v: 2, payer, participants: participants.map((p) => ({ id: p.id, name: p.name })), method };
    const mk = (shares, extra = {}) => ({ ...base, shares, ...extra });
    const result = (split, remainderIdx = [], order2 = order) => ({ ok: true, split, difference: 0, remainder: { cents: remainderIdx.length, to: remainderIdx.map((i) => order2[i]) } });

    if (method === 'percent') {
        const p = Object.fromEntries(order.map((id) => [id, Number(percents?.[id]) || 0]));
        const sum = Object.values(p).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 100) > 0.004) return { ok: false, split: mk({}, { percents: p }), difference: Math.round((100 - sum) * 100), remainder: { cents: 0, to: [] }, percentShort: true };
        const { parts, extra } = distribute(totalCents, order.map((id) => Math.round(p[id] * 100)));
        return result(mk(Object.fromEntries(order.map((id, i) => [id, parts[i]])), { percents: p }), extra);
    }
    if (method === 'fixed') {
        const shares = Object.fromEntries(order.map((id) => [id, toCents(fixed?.[id])]));
        const diff = totalCents - sumOf(shares);
        return { ok: diff === 0, split: mk(shares), difference: diff, remainder: { cents: 0, to: [] } };
    }
    if (method === 'items') {
        const lines = normalizeItems(items).filter((it) => it.amount !== null);
        const itemAllocations = {};
        const shares = Object.fromEntries(order.map((id) => [id, 0]));
        const extraTo = [];
        for (const it of lines) {
            const who = (allocations[it.id] || order).filter((id) => order.includes(id));
            const group = who.length ? who : order;
            const { parts, extra } = distribute(toCents(it.amount), group.map(() => 1));
            itemAllocations[it.id] = Object.fromEntries(group.map((id, i) => [id, parts[i]]));
            group.forEach((id, i) => (shares[id] += parts[i]));
            extra.forEach((i) => extraTo.push(group[i]));
        }
        const rest = totalCents - lines.reduce((s, it) => s + toCents(it.amount), 0);
        const { parts, extra } = distribute(rest, order.map(() => 1));
        const unallocated = Object.fromEntries(order.map((id, i) => [id, parts[i]]));
        order.forEach((id, i) => (shares[id] += parts[i]));
        extra.forEach((i) => extraTo.push(order[i]));
        return { ok: true, split: mk(shares, { itemAllocations, unallocated }), difference: 0, remainder: { cents: extraTo.length, to: extraTo } };
    }
    const { parts, extra } = distribute(totalCents, order.map(() => 1));
    return result(mk(Object.fromEntries(order.map((id, i) => [id, parts[i]]))), extra);
}

/** Read any stored splitData into v2 (or null: no split, a settlement, or an unreadable legacy value). `total` is the receipt total. */
export function readSplit(splitData, total) {
    const sd = splitData;
    if (!sd || typeof sd !== 'object' || sd.kind === 'settlement') return null;
    const totalCents = toCents(total);
    if (sd.v === 2 && Array.isArray(sd.participants) && sd.shares) {
        if (sumOf(sd.shares) === totalCents || totalCents === 0) return sd;
        return rescaleSplit(sd, totalCents); // the amount was edited after splitting: keep the relationships, re-divide
    }
    const hasShare = sd.yourShare !== undefined && sd.yourShare !== null && Number.isFinite(Number(sd.yourShare));
    if ((sd.method === 'equal' || sd.method === undefined || hasShare) && (Number(sd.people) >= 2 || hasShare) && !Array.isArray(sd.users)) {
        const n = Math.max(2, Math.round(Number(sd.people) || 2));
        const participants = [{ id: ME, name: 'Me' }, ...Array.from({ length: n - 1 }, (_, i) => ({ id: `p${i + 2}`, name: `Person ${i + 2}` }))];
        if (hasShare) {
            const mine = Math.min(totalCents, toCents(sd.yourShare));
            const { parts } = distribute(totalCents - mine, participants.slice(1).map(() => 1));
            return { v: 2, payer: ME, participants, method: 'fixed', shares: { [ME]: mine, ...Object.fromEntries(participants.slice(1).map((p, i) => [p.id, parts[i]])) }, legacy: true };
        }
        return { ...buildSplit({ total, method: 'equal', participants }).split, legacy: true };
    }
    if (Array.isArray(sd.users) && sd.users.length) {
        const participants = sd.users.map((u, i) => ({ id: i === 0 ? ME : `p${i + 1}`, name: i === 0 ? 'Me' : u.name || `Person ${i + 1}` }));
        const shares = Object.fromEntries(participants.map((p, i) => [p.id, toCents(sd.users[i].amount)]));
        const split = { v: 2, payer: ME, participants, method: 'fixed', shares, legacy: true };
        return sumOf(shares) === totalCents ? split : rescaleSplit(split, totalCents);
    }
    return null;
}

/** Same people and proportions, new total (exact cents). */
export function rescaleSplit(split, totalCents) {
    const order = ids(split.participants);
    const weights = split.method === 'equal' ? order.map(() => 1) : split.method === 'percent' && split.percents ? order.map((id) => Math.round((split.percents[id] || 0) * 100)) : order.map((id) => split.shares[id] || 0);
    const { parts } = distribute(totalCents, weights);
    const { itemAllocations, unallocated, ...rest } = split;
    void itemAllocations;
    void unallocated;
    return { ...rest, method: split.method === 'items' ? 'fixed' : split.method, shares: Object.fromEntries(order.map((id, i) => [id, parts[i]])) };
}

/** My share in cents (0 when I am not a participant). */
export const myShareCents = (splitData, total) => {
    const s = readSplit(splitData, total);
    return s ? s.shares[ME] || 0 : toCents(total);
};

/** What the money is worth to me for this receipt, in the receipt currency: my share when split, else the whole amount. */
export function effectiveAmount(receipt) {
    if (!receipt) return 0;
    const total = parseFloat(receipt.total) || 0;
    const s = readSplit(receipt.splitData, total);
    return s ? fromCents(s.shares[ME] || 0) : total;
}

export const isSettlement = (tx) => tx?.splitData?.kind === 'settlement';
export const paidByOther = (tx) => {
    const s = readSplit(tx?.splitData, tx?.total);
    return !!s && s.payer !== ME && (tx.transactionType || 'expense') === 'expense';
};

/** My fraction of one item's amount under an item-level split (null itemId = the unallocated remainder); undefined when not item-split. */
export function itemShareFraction(tx, itemId) {
    const s = readSplit(tx?.splitData, tx?.total);
    if (!s || s.method !== 'items') return undefined;
    const row = itemId ? s.itemAllocations?.[itemId] : s.unallocated;
    if (!row) return undefined;
    const all = sumOf(row);
    return all === 0 ? 0 : (row[ME] || 0) / all;
}

// ---------------------------------------------------------------------------
// Who owes whom
// ---------------------------------------------------------------------------

const baseRatio = (tx) => {
    const total = Number(tx.total) || 0;
    const base = tx.amountBase !== undefined && tx.amountBase !== null ? Number(tx.amountBase) : total;
    return total ? base / total : 1;
};

/**
 * Obligation lines created by a shared transaction: [{ txId, date, personId, name, cents, kind }]. cents > 0: that person owes me,
 * cents < 0: I owe them. A refund of a shared purchase (income with the same split) reverses the lines. Amounts in base currency.
 */
export function obligationsOf(tx) {
    if (isUnconverted(tx)) return []; // not converted yet: counted once its base amount is known
    const type = tx?.transactionType || 'expense';
    const s = readSplit(tx?.splitData, tx?.total);
    if (!s || (type !== 'expense' && type !== 'income')) return [];
    const sign = type === 'income' ? -1 : 1;
    const r = baseRatio(tx);
    const meta = { txId: tx.id, date: String(tx.date || '').slice(0, 10), kind: type === 'income' ? 'refund' : 'expense' };
    const nameOf = (id) => s.participants.find((p) => p.id === id)?.name || id;
    if (s.payer === ME) {
        return s.participants.filter((p) => p.id !== ME && (s.shares[p.id] || 0) !== 0).map((p) => ({ ...meta, personId: p.id, name: p.name, cents: sign * Math.round(s.shares[p.id] * r) }));
    }
    const mine = s.shares[ME] || 0;
    return mine ? [{ ...meta, personId: s.payer, name: nameOf(s.payer), cents: -sign * Math.round(mine * r) }] : [];
};

/** A settlement as a balance line: received from X reduces what X owes me; paid to X reduces what I owe X. */
export function settlementLine(tx) {
    if (!isSettlement(tx)) return null;
    const sd = tx.splitData;
    const cents = Math.round(toCents(tx.amountBase ?? tx.total));
    return { txId: tx.id, date: String(tx.date || '').slice(0, 10), personId: sd.personId, name: sd.name || sd.personId, cents: sd.direction === 'received' ? -cents : cents, kind: 'settlement', settles: sd.settles || [] };
}

/**
 * personBalances(transactions, people) -> [{ id, name, cents, events[] }] sorted by absolute balance.
 * cents > 0: owes me, < 0: I owe them. Each event of kind expense/refund carries `settled` when a settlement lists its transaction.
 */
export function personBalances(transactions = [], people = []) {
    const byId = new Map(people.map((p) => [p.id, { id: p.id, name: p.name, cents: 0, events: [] }]));
    const lines = [];
    for (const tx of transactions) {
        if (!tx || tx.isDemo) continue;
        if (isSettlement(tx)) {
            const l = settlementLine(tx);
            if (l) lines.push(l);
        } else lines.push(...obligationsOf(tx));
    }
    const settledByPerson = new Map();
    for (const l of lines) if (l.kind === 'settlement') for (const id of l.settles) settledByPerson.set(`${l.personId}:${id}`, true);
    for (const l of lines) {
        const e = byId.get(l.personId) || byId.set(l.personId, { id: l.personId, name: l.name, cents: 0, events: [] }).get(l.personId);
        if (!e.name || e.name === e.id) e.name = l.name;
        e.cents += l.cents;
        e.events.push({ ...l, settled: l.kind !== 'settlement' && !!settledByPerson.get(`${l.personId}:${l.txId}`) });
    }
    for (const e of byId.values()) e.events.sort((a, b) => b.date.localeCompare(a.date));
    return [...byId.values()].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.name.localeCompare(b.name));
}

export const owedToMe = (balances) => balances.filter((b) => b.cents > 0).reduce((s, b) => s + b.cents, 0);
export const iOwe = (balances) => -balances.filter((b) => b.cents < 0).reduce((s, b) => s + b.cents, 0);

// ---------------------------------------------------------------------------
// People list (stored in the synced prefs; needs no accounts)
// ---------------------------------------------------------------------------
const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `person-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`);
export const addPerson = (people = [], name) => {
    const n = String(name || '').trim();
    if (!n) return { people, person: null };
    const existing = people.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (existing) return { people, person: existing };
    const person = { id: newId(), name: n };
    return { people: [...people, person], person };
};

/** Settlement transaction (type transfer) for a person: what to pass to createTransaction. */
export function buildSettlement({ userId, person, direction, amount, date, accountId = null, currency = 'EUR', settles = [] }) {
    return {
        userId,
        transactionType: 'transfer',
        merchant: direction === 'received' ? `Settlement from ${person.name}` : `Settlement to ${person.name}`,
        total: Number(amount),
        currency,
        date,
        category: 'Transfer',
        accountId,
        splitData: { v: 2, kind: 'settlement', personId: person.id, name: person.name, direction, settles },
    };
}
