// Item correction rules and bulk-change previews (pass 2, section 3). Pure.
//
// Correcting one line changes that line only. "Also for future purchases" saves a rule for the product; applying a rule or a
// correction to HISTORY is a separate, previewed step, reversible with undo. Rules live in the existing `merchant_rules`
// table (no schema change): merchantKey = 'item:<productKey>', category = 'Category' or 'Category::subcategory'.
import { normalizeItems, serializeItems } from './receiptItems';
import { productKey } from './itemAnalysis';

export const ITEM_RULE_PREFIX = 'item:';
export const itemRuleKey = (name) => {
    const key = productKey(name);
    return key ? `${ITEM_RULE_PREFIX}${key}` : '';
};
export const isItemRule = (rule) => typeof rule?.merchantKey === 'string' && rule.merchantKey.startsWith(ITEM_RULE_PREFIX);

export const encodeRuleValue = ({ category, subcategory }) => (subcategory ? `${category}::${subcategory}` : category);
export function decodeRuleValue(value) {
    const [category, subcategory] = String(value || '').split('::');
    return { category: category || '', subcategory: subcategory || null };
}

/** The rule of the user for this item name, decoded, or null. */
export function matchItemRule(rules = [], name) {
    const key = itemRuleKey(name);
    if (!key) return null;
    const rule = (rules || []).find((r) => r.merchantKey === key);
    return rule ? { ...decodeRuleValue(rule.category), rule } : null;
}

/** Apply the user's item rules to freshly read items; lines the user already categorised are left alone. */
export function applyItemRules(items, rules = []) {
    return (items || []).map((it) => {
        if ((it.userEdited || []).includes('category')) return it;
        const hit = matchItemRule(rules, it.name);
        return hit && hit.category ? { ...it, category: hit.category, subcategory: hit.subcategory ?? it.subcategory ?? null } : it;
    });
}

/**
 * previewBulkItemChange(transactions, { name, category, subcategory, includeEdited })
 * Every stored line with the same product key whose category/subcategory would change:
 *   [{ txId, merchant, date, itemId, itemName, from: { category, subcategory }, to: { category, subcategory } }]
 * Lines the user edited themselves are skipped unless `includeEdited`. Nothing is written.
 */
export function previewBulkItemChange(transactions = [], { name, category, subcategory = null, includeEdited = false, excludeTxId = null } = {}) {
    const key = productKey(name);
    if (!key || !category) return [];
    const out = [];
    for (const tx of transactions) {
        if (!tx || tx.isDemo || tx.id === excludeTxId) continue;
        for (const it of normalizeItems(tx.lineItems, tx.category)) {
            if (productKey(it.name) !== key) continue;
            if (!includeEdited && it.userEdited.includes('category')) continue;
            const same = it.category === category && (it.subcategory || null) === (subcategory || null);
            if (same) continue;
            out.push({ txId: tx.id, merchant: tx.merchant, date: String(tx.date || '').slice(0, 10), itemId: it.id, itemName: it.name, from: { category: it.category, subcategory: it.subcategory }, to: { category, subcategory } });
        }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Group a preview by transaction and build the `lineItems` patch of each: [{ id, patch: { lineItems } }] for batchUpdateTransactions. */
export function bulkPatches(transactions, changes) {
    const byTx = new Map();
    for (const c of changes) (byTx.get(c.txId) || byTx.set(c.txId, []).get(c.txId)).push(c);
    const out = [];
    for (const [txId, list] of byTx) {
        const tx = transactions.find((t) => t.id === txId);
        if (!tx) continue;
        const items = normalizeItems(tx.lineItems, tx.category).map((it) => {
            const c = list.find((x) => x.itemId === it.id);
            if (!c) return it;
            return { ...it, category: c.to.category, subcategory: c.to.subcategory ?? null, userEdited: [...new Set([...it.userEdited, 'category', ...(c.to.subcategory ? ['subcategory'] : [])])], reviewStatus: 'confirmed' };
        });
        out.push({ id: txId, patch: { lineItems: serializeItems(items) } });
    }
    return out;
}
