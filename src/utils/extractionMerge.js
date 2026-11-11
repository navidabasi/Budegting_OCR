// Extraction results must never overwrite newer manual corrections (pass 2, section 8).
//
// Provenance lives in the transaction's `extraction` jsonb (no schema change):
//   extraction.editedAt = { total: ISO, merchant: ISO, ... }   per-field time of the last manual edit
//   extraction.suggested = { total, date, merchant }          what the scan read where the user's value was kept
// A transaction without any `extraction` is a manual entry: every field it already has is the user's.
// Pure functions; repo.js calls markEdited() on every user edit and pendingScans/scanAttach call mergeExtraction().

export const TRACKED_FIELDS = ['merchant', 'total', 'currency', 'date', 'category', 'lineItems'];
const SUGGEST_FIELDS = ['merchant', 'total', 'date', 'currency'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const hasValue = (field, tx) => {
    const v = tx[field];
    if (field === 'total') return Number(v) > 0;
    if (field === 'lineItems') return Array.isArray(v) && v.length > 0;
    if (field === 'category') return !!v && v !== 'Other';
    return v !== undefined && v !== null && v !== '';
};

/** Fields the user owns on this transaction (never to be replaced by an extraction). */
export function userEditedFields(tx) {
    if (!tx) return new Set();
    const ex = tx.extraction;
    if (!ex) return new Set(TRACKED_FIELDS.filter((f) => hasValue(f, tx)));
    return new Set(Object.keys(ex.editedAt || {}));
}

/**
 * The `extraction` object to store after a user edit, or null when nothing changes. Only scan-origin records
 * (those that already have `extraction`) track edits; a manual record is wholly the user's anyway.
 */
export function markEdited(existing, patch, now = new Date().toISOString()) {
    if (!existing?.extraction || patch?.extraction !== undefined) return null;
    const editedAt = { ...(existing.extraction.editedAt || {}) };
    let changed = false;
    for (const f of TRACKED_FIELDS) {
        if (patch[f] === undefined || same(patch[f], existing[f])) continue;
        editedAt[f] = now;
        changed = true;
    }
    return changed ? { ...existing.extraction, editedAt } : null;
}

/**
 * Merge a finished extraction into an existing transaction (an offline placeholder or a manual entry the scan is
 * attached to). `incoming` = { merchant, total, currency, date, category, lineItems }, `extraction` = metadata to store.
 * Returns { patch, kept } where `kept` lists the fields that were not replaced because the user owns them.
 */
export function mergeExtraction(existing, incoming, extraction = {}) {
    const edited = userEditedFields(existing);
    const patch = {};
    const kept = [];
    const suggested = { ...(existing.extraction?.suggested || {}) };

    for (const f of TRACKED_FIELDS) {
        const value = incoming[f];
        if (value === undefined || value === null || value === '' || (f === 'lineItems' && !value.length)) continue;
        if (edited.has(f)) {
            if (!same(value, existing[f])) {
                kept.push(f);
                if (SUGGEST_FIELDS.includes(f)) suggested[f] = value;
            }
            continue;
        }
        patch[f] = value;
    }

    const nextExtraction = {
        ...extraction,
        ...(existing.extraction?.editedAt ? { editedAt: existing.extraction.editedAt } : {}),
        ...(Object.keys(suggested).length ? { suggested } : {}),
        pending: false,
        needsReview: true,
    };
    patch.extraction = nextExtraction;
    return { patch, kept };
}
