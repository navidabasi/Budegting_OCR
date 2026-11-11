/**
 * Writing item corrections (pass 2, section 3). One line at a time by default; rules for future purchases and changes to
 * history are explicit separate steps (see utils/itemRules.js for the pure parts).
 */
import { batchUpdateTransactions, createRow, listRows, updateRow, updateTransaction } from '../data/repo';
import { editItem, normalizeItems, serializeItems } from '../utils/receiptItems';
import { bulkPatches, encodeRuleValue, itemRuleKey } from '../utils/itemRules';

/** Replace the items of a transaction (already v2). The receipt total is untouched. */
export function saveItems(tx, items) {
    return updateTransaction(tx.id, { lineItems: serializeItems(items) });
}

/** Change fields of ONE item. Returns the new item list. Other items and other receipts are not touched. */
export async function changeItem(tx, itemId, patch) {
    const items = normalizeItems(tx.lineItems, tx.category).map((it) => (it.id === itemId ? editItem(it, patch) : it));
    await saveItems(tx, items);
    return items;
}

/** Remember a category (and subcategory) for a product, for future purchases only. */
export async function saveItemRule(userId, name, { category, subcategory = null }) {
    const key = itemRuleKey(name);
    if (!key || !category) return null;
    const value = encodeRuleValue({ category, subcategory });
    const existing = (await listRows('rules', userId, (r) => r.merchantKey === key))[0];
    if (existing) return updateRow('rules', existing.id, { category: value, source: 'user', hitCount: (existing.hitCount || 0) + 1 });
    return createRow('rules', userId, { merchantKey: key, category: value, displayName: name, source: 'user', hitCount: 1 });
}

/** Apply a previewed change to history in one batch. Returns { count, undo() } (undo restores the previous items). */
export async function applyBulkItemChange(transactions, changes) {
    const previous = await batchUpdateTransactions(bulkPatches(transactions, changes));
    return { count: changes.length, receipts: previous.length, undo: () => batchUpdateTransactions(previous) };
}
