/**
 * Attach a scanned receipt to a transaction the user already entered by hand (pass 2, case 2): the photo is queued, the
 * scan fills what the manual entry left empty (items, time, merchant details), and the user's own amount, date, merchant
 * and category are kept (extractionMerge). Nothing is duplicated.
 */
import { getTransaction, updateTransaction } from '../data/repo';
import { queueImage, requestImageFlush } from '../data/images';
import { mergeExtraction } from '../utils/extractionMerge';

export async function attachScanToTransaction({ transactionId, userId, file, result, items }) {
    const current = await getTransaction(transactionId);
    if (!current) throw new Error('Transaction not found');
    const r = result.receipt;
    const imagePath = file ? await queueImage({ userId: userId || current.userId, transactionId, blob: file }) : current.imagePath;
    const { patch, kept } = mergeExtraction(
        current,
        { merchant: r.merchant, total: r.total ?? undefined, currency: r.currency, date: r.date, category: r.category, lineItems: items ?? [] },
        { ...result.extraction, confidence: r.confidence, paymentMethod: r.paymentMethod, time: r.time, merchantRaw: r.merchantRaw, tax: r.tax, attachedToManual: true }
    );
    await updateTransaction(transactionId, { ...patch, imagePath, extraction: { ...patch.extraction, needsReview: false } }, { system: true });
    if (file) requestImageFlush(userId || current.userId);
    return { kept };
}
