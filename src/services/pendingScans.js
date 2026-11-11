/**
 * Offline scans: a photo taken without a connection is queued (Dexie `images`) together with a placeholder
 * transaction flagged `extraction.pending = true`. When the app is back online `processPendingScans` reads each
 * photo through /api/extract-receipt and fills the placeholder in.
 */
import { createTransaction, getTransaction, listTransactions, updateTransaction } from '../data/repo';
import { mergeExtraction } from '../utils/extractionMerge';
import { queueImage, requestImageFlush, getSignedUrl } from '../data/images';
import { db, openDb } from '../data/db';
import { ScanError, extractReceipt, isRetryable } from './receiptScan';
import { dateKey } from '../utils/quickAdd';

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Save the photo + a placeholder transaction. Returns the transaction id. */
export async function createPendingScan({ userId, file, label, accountId = null, currency = 'EUR' }) {
    const id = newId();
    const imagePath = await queueImage({ userId, transactionId: id, blob: file, mime: file.type || 'image/jpeg' });
    await createTransaction({
        id,
        userId,
        merchant: label,
        total: 0,
        currency,
        category: 'Other',
        date: dateKey(0),
        accountId,
        imagePath,
        extraction: { pending: true, queuedAt: new Date().toISOString() },
    });
    return id;
}

async function blobFor(tx) {
    await openDb();
    const queued = await db.images.get(tx.id);
    if (queued?.blob) return queued.blob instanceof Blob ? queued.blob : new Blob([queued.blob], { type: queued.mime || 'image/jpeg' }); // (fake-indexeddb clones lose the jsdom Blob class)
    const url = await getSignedUrl(tx.imagePath);
    if (!url) throw new ScanError('network', 'image not available');
    const res = await fetch(url);
    if (!res.ok) throw new ScanError('network', 'image not available');
    return res.blob();
}

let running = null;

/** Process every pending placeholder once. Single-flight. Returns { processed, failed, remaining }. */
export function processPendingScans({ userId, getToken, getHints, fetchImpl }) {
    if (running) return running;
    running = (async () => {
        await Promise.resolve(); // the single-flight reset below must not run before `running` is assigned
        const out = { processed: 0, failed: 0, remaining: 0 };
        try {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return out;

            const pending = (await listTransactions(userId)).filter((tx) => tx.extraction?.pending && tx.imagePath);
            for (const tx of pending) {
                try {
                    const blob = await blobFor(tx);
                    const { receipt, extraction } = await extractReceipt({ file: blob, mime: blob.type || 'image/jpeg', hints: getHints(), getToken, fetchImpl });
                    // The transaction may have been edited or deleted while the photo was being read: read it again and
                    // let the user's own values win (extractionMerge), apply the rest.
                    const current = await getTransaction(tx.id);
                    if (!current) continue; // cancelled/deleted meanwhile: nothing to update, nothing to resurrect
                    const { patch } = mergeExtraction(
                        current,
                        {
                            merchant: receipt.merchant,
                            total: receipt.total ?? undefined,
                            currency: receipt.currency,
                            date: receipt.date,
                            category: receipt.category,
                            lineItems: receipt.items.map((it) => ({ name: it.name, quantity: it.quantity, price: it.price, category: it.category || receipt.category || '' })),
                        },
                        { ...extraction, confidence: receipt.confidence, paymentMethod: receipt.paymentMethod, time: receipt.time, merchantRaw: receipt.merchantRaw, tax: receipt.tax }
                    );
                    await updateTransaction(tx.id, patch, { system: true });
                    out.processed++;
                } catch (err) {
                    if (isRetryable(err)) {
                        out.remaining++;
                        if (err.kind === 'offline' || err.kind === 'network') break;
                    } else {
                        out.failed++;
                        const cur = await getTransaction(tx.id);
                        if (cur) await updateTransaction(tx.id, { extraction: { ...cur.extraction, pending: false, failed: true, error: err.kind || 'error' } }, { system: true }).catch(() => {});
                    }
                }
            }
            if (out.processed) requestImageFlush(userId);
        } finally {
            running = null;
        }
        return out;
    })();
    return running;
}
