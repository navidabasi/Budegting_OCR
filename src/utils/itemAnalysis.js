// Item-level analysis (pass 2, section 3). Pure, no I/O.
//
// Rules that keep the numbers honest:
//  - Spending totals (merchant ranking, month totals) use the RECEIPT total, never the items.
//  - Item analysis uses items plus the receipt's `unallocated` remainder, so the lines of one receipt always add up to the
//    receipt total exactly: nothing is counted twice and nothing disappears (reconcile() in receiptItems.js).
//  - Amounts are in the base currency (amountBase scaled to each line) and, by default, on the personal-share basis.
//  - Every row carries `refs` (receipt id + line id + amount) so any number can lead to the receipts and lines behind it.
//  - Unit prices are only compared between lines whose units are comparable (mass with mass, volume with volume, count with count).
import { normalizeItems, reconcile, round2 } from './receiptItems';
import { fullAmount, isPlanned, itemShareFactor, shareAmount, typeOf } from './money';
import { inPeriod } from './period';
import { displayName, merchantKey } from './merchant';

const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};

/** Expenses in the period that count as money spent (planned/unpaid and transfers/income left out). */
export function periodExpenses(transactions = [], period) {
    return (transactions || []).filter((tx) => tx && typeOf(tx) === 'expense' && !isPlanned(tx) && !tx.isDemo && (period === undefined || period === null || inPeriod(tx.date, period)));
}

const keyOfMerchant = (tx) => tx.merchantKey || merchantKey(tx.merchant) || 'unknown';

/**
 * Lines of one receipt in base currency on the chosen basis ('share' = your part, 'full' = cash amount):
 * [{ txId, itemId|null, name, category, subcategory, amount, unallocated, merchant, date }]
 * The rows sum to the receipt amount (share or full). The remainder row is flagged `unallocated`.
 */
export function allocationsOf(tx, { basis = 'share' } = {}) {
    const total = num(tx.total);
    const full = fullAmount(tx);
    const ratio = total ? full / total : 1; // base currency per receipt-currency unit
    const factor = (itemId) => (basis === 'full' ? 1 : itemShareFactor(tx, itemId));
    const meta = { txId: tx.id, merchant: displayName(tx.merchant) || tx.merchant || '', date: String(tx.date || '').slice(0, 10) };
    const rec = reconcile(tx);
    const rows = normalizeItems(tx.lineItems, tx.category)
        .filter((it) => it.amount !== null)
        .map((it) => ({ ...meta, itemId: it.id, name: it.name, category: it.category || tx.category || 'Other', subcategory: it.subcategory || null, amount: it.amount * ratio * factor(it.id), unallocated: false }));
    if (!rec.hasItems || rec.unallocated !== 0) {
        rows.push({ ...meta, itemId: null, name: null, category: tx.category || 'Other', subcategory: null, amount: rec.unallocated * ratio * factor(null), unallocated: true });
    }
    return rows;
}

const basisAmount = (tx, basis) => (basis === 'full' ? fullAmount(tx) : shareAmount(tx));

// ---------------------------------------------------------------------------
// Merchants (receipt totals)
// ---------------------------------------------------------------------------

/** Merchant ranking by receipt totals: [{ key, name, total, count, itemised, lastDate, refs }] largest first. */
export function spendByMerchant(transactions, period, { basis = 'share', category } = {}) {
    const groups = new Map();
    for (const tx of periodExpenses(transactions, period)) {
        if (category && tx.category !== category) continue;
        const key = keyOfMerchant(tx);
        const g = groups.get(key) || { key, name: displayName(tx.merchant) || tx.merchant || '', total: 0, count: 0, itemised: 0, lastDate: '', refs: [] };
        const amount = basisAmount(tx, basis);
        g.total += amount;
        g.count += 1;
        g.itemised += allocationsOf(tx, { basis }).filter((r) => !r.unallocated).reduce((s, r) => s + r.amount, 0);
        const date = String(tx.date || '').slice(0, 10);
        if (date > g.lastDate) g.lastDate = date;
        g.refs.push({ txId: tx.id, itemId: null, amount: round2(amount), date, merchant: g.name });
        groups.set(key, g);
    }
    return [...groups.values()]
        .map((g) => ({ ...g, total: round2(g.total), itemised: round2(g.itemised), refs: g.refs.sort((a, b) => b.date.localeCompare(a.date)) }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Categories and subcategories (items + unallocated)
// ---------------------------------------------------------------------------

function aggregate(rows, keyFn, labelFn) {
    const groups = new Map();
    for (const r of rows) {
        const key = keyFn(r);
        const g = groups.get(key) || { key, label: labelFn ? labelFn(r) : key, total: 0, itemised: 0, unallocated: 0, refs: [] };
        g.total += r.amount;
        if (r.unallocated) g.unallocated += r.amount;
        else g.itemised += r.amount;
        g.refs.push({ txId: r.txId, itemId: r.itemId, name: r.name, merchant: r.merchant, date: r.date, amount: round2(r.amount), unallocated: r.unallocated });
        groups.set(key, g);
    }
    return [...groups.values()]
        .map((g) => ({ ...g, total: round2(g.total), itemised: round2(g.itemised), unallocated: round2(g.unallocated), refs: g.refs.sort((a, b) => b.date.localeCompare(a.date)) }))
        .sort((a, b) => b.total - a.total);
}

export function allocationsInPeriod(transactions, period, { basis = 'share' } = {}) {
    return periodExpenses(transactions, period).flatMap((tx) => allocationsOf(tx, { basis }));
}

/** Spend by category from the items (the receipt remainder stays with the receipt's own category, flagged unallocated). */
export function spendByCategory(transactions, period, { basis = 'share' } = {}) {
    return aggregate(allocationsInPeriod(transactions, period, { basis }), (r) => r.category || 'Other').map((g) => ({ ...g, category: g.key }));
}

/** Subcategories of one category; lines without a subcategory (and the unallocated remainder) are grouped under key 'unknown'. */
export function spendBySubcategory(transactions, period, { category = 'Groceries', basis = 'share' } = {}) {
    const rows = allocationsInPeriod(transactions, period, { basis }).filter((r) => r.category === category);
    return aggregate(rows, (r) => r.subcategory || 'unknown').map((g) => ({ ...g, subcategory: g.key }));
}

/**
 * Item-detail coverage of a category: how much of the spend of receipts in `category` is explained by item lines.
 * { total, itemised, unknown, share (0..1), receipts, receiptsWithItems }. `unknown` is the amount without item detail.
 */
export function coverage(transactions, period, { category, basis = 'share' } = {}) {
    let total = 0;
    let itemised = 0;
    let receipts = 0;
    let withItems = 0;
    for (const tx of periodExpenses(transactions, period)) {
        if (category && tx.category !== category) continue;
        receipts += 1;
        const rows = allocationsOf(tx, { basis });
        const amount = rows.reduce((s, r) => s + r.amount, 0);
        const known = rows.filter((r) => !r.unallocated).reduce((s, r) => s + r.amount, 0);
        total += amount;
        itemised += Math.min(known, Math.max(amount, 0));
        if (reconcile(tx).hasItems) withItems += 1;
    }
    total = round2(total);
    itemised = round2(itemised);
    return { total, itemised, unknown: round2(Math.max(0, total - itemised)), share: total > 0 ? Math.min(1, itemised / total) : 0, receipts, receiptsWithItems: withItems };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const UNIT_WORDS = new Set(['kg', 'g', 'gr', 'l', 'lt', 'ml', 'cl', 'pz', 'pc', 'pcs', 'x', 'conf', 'bio']);
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Cautious product key: lowercase, accents/punctuation/digits and unit tokens removed. "Latte intero 1L" -> "latte intero". Empty when nothing is left. */
export function productKey(name) {
    const tokens = stripAccents(String(name || '').toLowerCase())
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1 && !UNIT_WORDS.has(t));
    return tokens.join(' ');
}

/** Items bought repeatedly: same product key on at least `minReceipts` different receipts. [{ key, name, count, receipts, total, average, lastDate, merchants, refs }] */
export function recurringProducts(transactions, period, { basis = 'share', minReceipts = 3 } = {}) {
    const groups = new Map();
    for (const tx of periodExpenses(transactions, period)) {
        for (const r of allocationsOf(tx, { basis })) {
            if (r.unallocated || !r.name) continue;
            const key = productKey(r.name);
            if (!key) continue;
            const g = groups.get(key) || { key, name: r.name, count: 0, txIds: new Set(), total: 0, lastDate: '', merchants: new Set(), refs: [] };
            g.count += 1;
            g.txIds.add(r.txId);
            g.total += r.amount;
            if (r.date > g.lastDate) {
                g.lastDate = r.date;
                g.name = r.name;
            }
            g.merchants.add(r.merchant);
            g.refs.push({ txId: r.txId, itemId: r.itemId, name: r.name, merchant: r.merchant, date: r.date, amount: round2(r.amount) });
            groups.set(key, g);
        }
    }
    return [...groups.values()]
        .filter((g) => g.txIds.size >= minReceipts)
        .map((g) => ({ key: g.key, name: g.name, count: g.count, receipts: g.txIds.size, total: round2(g.total), average: round2(g.total / g.count), lastDate: g.lastDate, merchants: [...g.merchants], refs: g.refs.sort((a, b) => b.date.localeCompare(a.date)) }))
        .sort((a, b) => b.total - a.total);
}

// Unit families: prices can only be compared inside one family, after conversion to its base unit.
const UNIT_TABLE = { kg: ['mass', 'kg', 1], g: ['mass', 'kg', 1000], l: ['volume', 'l', 1], cl: ['volume', 'l', 100], ml: ['volume', 'l', 1000], pc: ['count', 'pc', 1] };

/**
 * Price per base unit of an item, or null when the line has no unit. A printed unit price wins; otherwise it is derived from
 * quantity and amount (flagged `derived`). { family, base, value (receipt currency per base unit), derived }
 */
export function unitPriceOf(item) {
    const spec = UNIT_TABLE[item?.unit];
    if (!spec) return null;
    const [family, base, perBase] = spec;
    if (Number.isFinite(item.unitPrice) && item.unitPrice > 0) return { family, base, value: item.unitPrice * perBase, derived: false };
    if (Number.isFinite(item.quantity) && item.quantity > 0 && Number.isFinite(item.amount)) return { family, base, value: (item.amount / item.quantity) * perBase, derived: true };
    return null;
}

/**
 * Unit-price history per product. `comparable` is true only when every priced line of the product is in one unit family,
 * so kg and litre prices (or a count-based price) are never mixed. Prices are in the base currency of each receipt.
 * [{ key, name, comparable, families, family, base, points[{ date, merchant, value, derived, txId, itemId }], min, max, first, latest, changePct }]
 */
export function comparableUnitPrices(transactions, period, { minPoints = 2 } = {}) {
    const groups = new Map();
    for (const tx of periodExpenses(transactions, period)) {
        const total = num(tx.total);
        const ratio = total ? fullAmount(tx) / total : 1;
        for (const it of normalizeItems(tx.lineItems, tx.category)) {
            const up = unitPriceOf(it);
            const key = productKey(it.name);
            if (!up || !key) continue;
            const g = groups.get(key) || { key, name: it.name, points: [], families: new Set() };
            g.families.add(`${up.family}:${up.base}`);
            g.points.push({ date: String(tx.date || '').slice(0, 10), merchant: displayName(tx.merchant) || tx.merchant || '', value: round2(up.value * ratio), derived: up.derived, family: up.family, base: up.base, txId: tx.id, itemId: it.id });
            groups.set(key, g);
        }
    }
    return [...groups.values()]
        .filter((g) => g.points.length >= minPoints)
        .map((g) => {
            const families = [...g.families];
            const comparable = families.length === 1;
            const points = g.points.sort((a, b) => a.date.localeCompare(b.date));
            const values = points.map((p) => p.value);
            const first = values[0];
            const latest = values[values.length - 1];
            return {
                key: g.key,
                name: g.name,
                comparable,
                families,
                family: comparable ? points[0].family : null,
                base: comparable ? points[0].base : null,
                points,
                min: comparable ? Math.min(...values) : null,
                max: comparable ? Math.max(...values) : null,
                first: comparable ? first : null,
                latest: comparable ? latest : null,
                changePct: comparable && first > 0 ? ((latest - first) / first) * 100 : null,
            };
        })
        .sort((a, b) => b.points.length - a.points.length);
}

// ---------------------------------------------------------------------------
// Change between two comparable periods
// ---------------------------------------------------------------------------

/**
 * Change of spend per group between two periods (use comparablePeriods() from period.js to choose them).
 *   by: 'merchant' (receipt totals) | 'category' | 'subcategory' (items + unallocated; needs `category` for subcategories)
 * -> { current, previous, delta, pct, rows: [{ key, current, previous, delta, refs }] } sorted by absolute change.
 */
export function changeBetween(transactions, currentPeriod, previousPeriod, { by = 'category', category, basis = 'share' } = {}) {
    const pick = (period) => {
        if (by === 'merchant') return spendByMerchant(transactions, period, { basis, category }).map((g) => ({ key: g.key, label: g.name, total: g.total, refs: g.refs }));
        if (by === 'subcategory') return spendBySubcategory(transactions, period, { category, basis }).map((g) => ({ key: g.key, label: g.key, total: g.total, refs: g.refs }));
        return spendByCategory(transactions, period, { basis }).map((g) => ({ key: g.key, label: g.key, total: g.total, refs: g.refs }));
    };
    const cur = pick(currentPeriod);
    const prev = pick(previousPeriod);
    const keys = new Set([...cur.map((g) => g.key), ...prev.map((g) => g.key)]);
    const get = (list, key) => list.find((g) => g.key === key);
    const rows = [...keys]
        .map((key) => {
            const c = get(cur, key);
            const p = get(prev, key);
            const current = c?.total || 0;
            const previous = p?.total || 0;
            return { key, label: c?.label || p?.label || key, current, previous, delta: round2(current - previous), refs: c?.refs || [], previousRefs: p?.refs || [] };
        })
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const current = round2(cur.reduce((s, g) => s + g.total, 0));
    const previous = round2(prev.reduce((s, g) => s + g.total, 0));
    return { current, previous, delta: round2(current - previous), pct: previous > 0 ? ((current - previous) / previous) * 100 : null, rows };
}
