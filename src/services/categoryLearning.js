/**
 * Learning from category corrections (plan P3-T3). Every place where the user changes a transaction's
 * category calls `onCategoryChanged`: it updates the transaction, upserts a user merchant rule
 * (hitCount + 1) and reports how many other transactions from the same merchant could follow.
 * `applyCategoryToMatches` recategorises those in one batch and returns an undo function.
 */
import { batchUpdateTransactions, createRow, listRows, listTransactions, updateRow, updateTransaction } from '../data/repo';
import { displayName, merchantKey } from '../utils/merchant';

export const keyOf = (tx) => tx?.merchantKey || (tx?.transactionType === 'transfer' ? '' : merchantKey(tx?.merchant));

const isExpense = (tx) => (tx.transactionType || 'expense') === 'expense';

/** Other expenses from the same merchant that do not have `category` yet. Pure. */
export function findMatches(transactions, transaction, category) {
    const key = keyOf(transaction);
    if (!key) return [];
    return (transactions || []).filter((tx) => tx && tx.id !== transaction.id && isExpense(tx) && !tx.isDemo && tx.category !== category && keyOf(tx) === key);
}

/** How many transactions (the changed one included) share the merchant key. Used for the "Applies to all N" hint. */
export function countSameMerchant(transactions, transaction) {
    const key = keyOf(transaction);
    if (!key) return 0;
    return (transactions || []).filter((tx) => tx && isExpense(tx) && keyOf(tx) === key).length;
}

/** Create or bump the user's rule for a merchant key. source 'user' always wins over 'llm'/'seed'. */
export async function upsertUserRule(userId, key, category, name, { source = 'user', bump = true } = {}) {
    const rules = await listRows('rules', userId, (r) => r.merchantKey === key);
    const existing = rules[0];
    if (existing) {
        if (source !== 'user' && existing.source === 'user') return existing; // never overwrite a correction by a model guess
        return updateRow('rules', existing.id, {
            category,
            source,
            displayName: existing.displayName || name || null,
            hitCount: (existing.hitCount || 0) + (bump ? 1 : 0),
        });
    }
    return createRow('rules', userId, { merchantKey: key, category, displayName: name || null, source, hitCount: 1 });
}

/**
 * onCategoryChanged(transaction, newCategory) -> { transaction, rule, key, name, matches }
 * `matches` are the other transactions of the same merchant that could be recategorised.
 */
export async function onCategoryChanged(transaction, newCategory) {
    if (!transaction?.id || !newCategory || transaction.category === newCategory) return { transaction, rule: null, key: '', name: '', matches: [] };
    await updateTransaction(transaction.id, { category: newCategory });
    const updated = { ...transaction, category: newCategory };
    const key = keyOf(transaction);
    if (!key || !isExpense(transaction) || !transaction.userId || newCategory === 'Transfer' || newCategory === 'Income') {
        return { transaction: updated, rule: null, key: '', name: '', matches: [] };
    }
    const name = displayName(transaction.merchant) || transaction.merchant;
    let rule = null;
    try {
        rule = await upsertUserRule(transaction.userId, key, newCategory, name);
    } catch (err) {
        console.warn('[learning] could not save the merchant rule', err);
    }
    const matches = findMatches(await listTransactions(transaction.userId), transaction, newCategory);
    return { transaction: updated, rule, key, name, matches };
}

/** Set `category` on every match in one batch. Returns { count, undo } where undo() restores the previous categories. */
export async function applyCategoryToMatches(matches, category) {
    const previous = await batchUpdateTransactions(matches.map((tx) => ({ id: tx.id, patch: { category } })));
    return { count: previous.length, undo: () => batchUpdateTransactions(previous) };
}
