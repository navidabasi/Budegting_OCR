/**
 * Per-record sync state (pass 2, section 8): derived from the outbox, the image queue and the extraction flags. Pure.
 *
 *   saved_local  the change is stored on this device and is being sent
 *   waiting      it is queued and waiting for a connection (offline, or a send failed transiently and will be retried)
 *   synced       the server has it
 *   attention    a send failed permanently (rejected by the server): needs a retry or a discard
 *
 * Record, image and analysis (receipt reading) have separate states; `overall` is the most urgent one.
 */
export const STATE = { SAVED_LOCAL: 'saved_local', WAITING: 'waiting', SYNCED: 'synced', ATTENTION: 'attention' };
const RANK = { [STATE.SYNCED]: 0, [STATE.SAVED_LOCAL]: 1, [STATE.WAITING]: 2, [STATE.ATTENTION]: 3 };

const worst = (...states) => states.filter(Boolean).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), STATE.SYNCED);

function queuedState(rows, online) {
    if (!rows.length) return STATE.SYNCED;
    if (rows.some((r) => r.status === 'failed')) return STATE.ATTENTION;
    return rows.some((r) => !online || (r.tries || 0) > 0) ? STATE.WAITING : STATE.SAVED_LOCAL;
}

/** Map transactionId -> { record, image, analysis, overall } for the given transactions. */
export function computeRecordSyncStates({ transactions = [], outbox = [], images = [], online = true } = {}) {
    const byRecord = new Map();
    for (const e of outbox) {
        if (e.table !== 'transactions') continue;
        (byRecord.get(e.recordId) || byRecord.set(e.recordId, []).get(e.recordId)).push(e);
    }
    const imageByTx = new Map();
    for (const im of images) {
        if (im.kind === 'delete') continue;
        (imageByTx.get(im.transactionId) || imageByTx.set(im.transactionId, []).get(im.transactionId)).push(im);
    }
    const out = new Map();
    for (const tx of transactions) {
        const record = queuedState(byRecord.get(tx.id) || [], online);
        const image = tx.imagePath || imageByTx.has(tx.id) ? queuedState(imageByTx.get(tx.id) || [], online) : null;
        let analysis = null;
        if (tx.extraction?.pending) analysis = online ? STATE.SAVED_LOCAL : STATE.WAITING;
        else if (tx.extraction?.failed) analysis = STATE.ATTENTION;
        out.set(tx.id, { record, image, analysis, overall: worst(record, image, analysis) });
    }
    return out;
}

/** Counts for the global indicator. */
export function summarizeQueue({ outbox = [], images = [], online = true } = {}) {
    const failedOps = outbox.filter((e) => e.status === 'failed');
    const pendingOps = outbox.filter((e) => e.status === 'pending');
    const failedImages = images.filter((r) => r.status === 'failed');
    const pendingImages = images.filter((r) => r.status === 'pending');
    const pending = pendingOps.length + pendingImages.length;
    const failed = failedOps.length + failedImages.length;
    const state = failed ? STATE.ATTENTION : pending ? (online ? STATE.SAVED_LOCAL : STATE.WAITING) : STATE.SYNCED;
    return { pending, failed, pendingOps: pendingOps.length, pendingImages: pendingImages.length, state };
}
