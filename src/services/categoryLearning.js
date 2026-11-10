/**
 * Hook point for learning from category corrections (plan P3-T3). Every place where the user changes a
 * transaction's category calls this. For now it only updates the transaction; rule learning
 * (upsert a merchant rule, "apply to all N receipts") is added here later.
 */
import { updateTransaction } from '../data/repo';

export async function onCategoryChanged(transaction, newCategory) {
    if (!transaction?.id || !newCategory || transaction.category === newCategory) return transaction;
    await updateTransaction(transaction.id, { category: newCategory });
    return { ...transaction, category: newCategory };
}
