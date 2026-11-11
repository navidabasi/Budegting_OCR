// Receipt line items, versioned shape (pass 2, section 3). Pure.
//
// Stored in the existing `receipts.line_items` jsonb (no schema change). Item shape v2:
//   { v: 2, id, rawText, name, category, subcategory, amount, quantity?, unit?, packSize?, unitPrice?, discount?, taxRate?,
//     reviewStatus: 'auto' | 'needs_review' | 'confirmed', userEdited: string[] }
//
//  - amount      net line amount as charged, in the receipt currency (a discount printed on the line is already inside it;
//                `discount` only records how much was taken off, so it is never subtracted twice)
//  - rawText     the line as printed on the receipt (null for hand-typed items and for items saved before v2)
//  - unit        'kg' | 'g' | 'l' | 'ml' | 'cl' | 'pc' (what quantity / unitPrice refer to), only when printed
//  - userEdited  fields the user changed; a later reading or bulk rule never overwrites them
// Old items ({ name, quantity, price, category }) are read unchanged by normalizeItem and keep working in every consumer
// because serializeItem also writes the legacy `price` (= amount) and `quantity`.
import { hashString } from './stableHash';

export const ITEM_VERSION = 2;
export const REVIEW_STATUS = ['auto', 'needs_review', 'confirmed'];
export const UNITS = ['kg', 'g', 'l', 'ml', 'cl', 'pc'];
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `it-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`);

/** An item that has no readable name or no amount. */
export const isIncomplete = (item) => !text(item?.name) || item?.amount === null || item?.amount === undefined;

/**
 * Read any stored item (legacy or v2) into the v2 shape. Never throws, never invents values:
 * legacy items keep name/price/quantity/category; their id is derived from their content so it is stable across reads.
 */
export function normalizeItem(raw, { index = 0, receiptCategory = '' } = {}) {
    const it = raw && typeof raw === 'object' ? raw : {};
    const amount = num(it.amount ?? it.price);
    const name = typeof it.name === 'string' ? it.name.trim() : '';
    const legacy = it.v !== ITEM_VERSION;
    const out = {
        v: ITEM_VERSION,
        id: typeof it.id === 'string' && it.id ? it.id : `l-${hashString(`${index}|${name}|${amount}`).slice(0, 10)}`,
        rawText: text(it.rawText),
        name,
        category: text(it.category) || receiptCategory || '',
        subcategory: text(it.subcategory),
        amount,
        userEdited: Array.isArray(it.userEdited) ? it.userEdited.filter((f) => typeof f === 'string') : [],
        reviewStatus: REVIEW_STATUS.includes(it.reviewStatus) ? it.reviewStatus : null,
    };
    const quantity = num(it.quantity);
    if (quantity !== null) out.quantity = quantity;
    const unit = typeof it.unit === 'string' && UNITS.includes(it.unit.toLowerCase()) ? it.unit.toLowerCase() : null;
    if (unit) out.unit = unit;
    const packSize = text(it.packSize) || (typeof it.packSize === 'number' ? String(it.packSize) : null);
    if (packSize) out.packSize = packSize;
    for (const k of ['unitPrice', 'discount', 'taxRate']) {
        const v = num(it[k]);
        if (v !== null) out[k] = v;
    }
    if (!out.reviewStatus) {
        // Items saved before v2 went through the scan review or were typed by hand, so they count as confirmed unless unreadable.
        out.reviewStatus = isIncomplete(out) ? 'needs_review' : legacy ? 'confirmed' : 'auto';
    }
    return out;
}

/** All items of a transaction in v2 shape. */
export function normalizeItems(lineItems, receiptCategory = '') {
    return (Array.isArray(lineItems) ? lineItems : []).map((it, index) => normalizeItem(it, { index, receiptCategory }));
}

/** Stored form: v2 fields plus the legacy `price` (= amount) and `quantity` so older readers (CSV export, categoriser, insights) keep working. */
export function serializeItem(item) {
    const it = normalizeItem(item);
    const out = { ...it, price: it.amount === null ? null : round2(it.amount), quantity: it.quantity ?? 1 };
    if (out.amount !== null) out.amount = round2(out.amount);
    for (const k of Object.keys(out)) if (out[k] === null && !['amount', 'price', 'rawText', 'subcategory'].includes(k)) delete out[k];
    return out;
}

export const serializeItems = (items) => (items || []).map(serializeItem);

/** Edit one item: only the given fields change, they are recorded in userEdited, and the item becomes confirmed. */
export function editItem(item, patch) {
    const base = normalizeItem(item);
    const changed = Object.keys(patch).filter((k) => JSON.stringify(patch[k] ?? null) !== JSON.stringify(base[k] ?? null));
    if (!changed.length) return base;
    const next = { ...base, ...patch };
    next.userEdited = [...new Set([...base.userEdited, ...changed])];
    next.reviewStatus = 'confirmed';
    return normalizeItem(next);
}

/** Build v2 items from an extraction response (client-parsed). Uncertain lines are flagged for review, nothing is invented. */
export function itemsFromExtraction(items, { category = '', confidence = null } = {}) {
    const uncertain = typeof confidence === 'number' && confidence < 0.7;
    return (items || []).map((raw, index) => {
        const base = normalizeItem(
            {
                v: ITEM_VERSION,
                id: newId(),
                rawText: raw.rawText ?? null,
                name: raw.name,
                category: raw.category || category,
                subcategory: raw.subcategory ?? null,
                amount: raw.price ?? raw.amount,
                quantity: raw.quantity,
                unit: raw.unit,
                packSize: raw.packSize,
                unitPrice: raw.unitPrice,
                discount: raw.discount,
                taxRate: raw.taxRate,
                reviewStatus: 'auto',
            },
            { index, receiptCategory: category }
        );
        return isIncomplete(base) || uncertain ? { ...base, reviewStatus: 'needs_review' } : base;
    });
}

/** Which fields of an item are uncertain (shown with a flag in the review list). */
export function uncertainFields(item) {
    const it = normalizeItem(item);
    if (it.reviewStatus === 'confirmed') return [];
    const out = [];
    if (!it.name) out.push('name');
    if (it.amount === null) out.push('amount');
    if (it.reviewStatus === 'needs_review' && !out.length) out.push('amount');
    if (it.category && !it.userEdited.includes('category') && it.reviewStatus === 'needs_review') out.push('category');
    return out;
}

// ---------------------------------------------------------------------------
// Reconciliation: receipt total vs items
// ---------------------------------------------------------------------------

/**
 * reconcile(receipt) -> { total, itemsSum, unallocated, status, coverage, unknownCount, hasItems }
 *   itemsSum     sum of known item amounts (net, discounts already inside)
 *   unallocated  total - itemsSum: > 0 shortfall (lines not read), < 0 excess (items add up to more than was paid)
 *   status       'no_items' | 'complete' (within one cent) | 'shortfall' | 'excess'
 *   coverage     share of the receipt total that the items explain, 0..1
 *   unknownCount items without an amount
 * The receipt total is what was paid and always wins: spending totals never use items.
 */
export function reconcile(receipt) {
    const total = round2(num(receipt?.total) ?? 0);
    const items = normalizeItems(receipt?.lineItems, receipt?.category);
    const known = items.filter((it) => it.amount !== null);
    const itemsSum = round2(known.reduce((s, it) => s + it.amount, 0));
    const unallocated = round2(total - itemsSum);
    let status = 'complete';
    if (!items.length) status = 'no_items';
    else if (unallocated > 0.009) status = 'shortfall';
    else if (unallocated < -0.009) status = 'excess';
    const coverage = total > 0 && items.length ? Math.max(0, Math.min(1, itemsSum / total)) : 0;
    return { total, itemsSum, unallocated: Math.abs(unallocated) < 0.005 ? 0 : unallocated, status, coverage, unknownCount: items.length - known.length, hasItems: items.length > 0 };
}

/**
 * "Assign the difference": an explicit adjustment item that takes the unallocated amount (positive for a shortfall,
 * negative for an excess such as a receipt-wide discount), so items add up to the total. The user picks category and name.
 */
export function assignDifference(receipt, { name, category, subcategory = null } = {}) {
    const { unallocated } = reconcile(receipt);
    if (Math.abs(unallocated) < 0.005) return normalizeItems(receipt.lineItems, receipt.category);
    const adjustment = normalizeItem({
        v: ITEM_VERSION,
        id: newId(),
        rawText: null,
        name: name || 'Adjustment',
        category: category || receipt.category || '',
        subcategory,
        amount: unallocated,
        reviewStatus: 'confirmed',
        userEdited: ['amount', 'name', 'category'],
    });
    return [...normalizeItems(receipt.lineItems, receipt.category), adjustment];
}

// ---------------------------------------------------------------------------
// Quick Add edit: rows ({ id?, name, price }) back to items without losing what the sheet cannot show
// ---------------------------------------------------------------------------

/**
 * mergeEditedItems(original, rows, { category }) -> v2 items.
 * A row that matches an original item by id and has the same name and price keeps that item untouched (subcategory, unit,
 * rawText, review status...). A changed row edits the item (recorded in userEdited). A row without a known id is a new
 * hand-typed item in `category`. Rows with no name or no price are dropped.
 */
export function mergeEditedItems(original, rows, { category = '' } = {}) {
    const byId = new Map(normalizeItems(original, category).map((it) => [it.id, it]));
    const out = [];
    for (const row of rows || []) {
        const name = String(row?.name || '').trim();
        const amount = num(row?.price);
        if (!name || amount === null) continue;
        const base = row.id ? byId.get(row.id) : null;
        if (base) {
            const patch = {};
            if (name !== base.name) patch.name = name;
            if (base.amount === null || round2(amount) !== round2(base.amount)) patch.amount = round2(amount);
            out.push(Object.keys(patch).length ? editItem(base, patch) : base);
        } else {
            out.push(normalizeItem({ v: ITEM_VERSION, id: newId(), name, amount: round2(amount), category, reviewStatus: 'confirmed', userEdited: ['name', 'amount'] }));
        }
    }
    return out;
}

/** Rows for the Quick Add editor from stored items. */
export const itemsToRows = (lineItems, receiptCategory = '') => normalizeItems(lineItems, receiptCategory).map((it) => ({ id: it.id, name: it.name, price: it.amount !== null ? String(it.amount) : '' }));
