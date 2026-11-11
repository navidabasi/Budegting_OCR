/**
 * Drafts (pass 2, sections 2 and 8): unsaved Quick Add / Scan work kept in IndexedDB so it survives sheet dismissal, closing
 * the app and service-worker updates. One draft per user and kind. Best effort: a storage failure never blocks the form.
 *
 * Draft row: { id: `${userId}:${kind}`, userId, kind: 'quickadd' | 'scan', data (JSON), blob? (scan photo), updatedAt }
 */
import { db, openDb } from './db';

export const DRAFT_KINDS = ['quickadd', 'scan'];
const idFor = (userId, kind) => `${userId}:${kind}`;

const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
export const subscribeDrafts = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
};

/** Has the form got anything worth keeping? */
export function isMeaningfulQuickAddDraft(state) {
    if (!state) return false;
    return !!(String(state.expr || '').trim() || String(state.merchant || '').trim() || state.more?.items?.some((it) => it.name || it.price) || String(state.more?.notes || '').trim());
}

export async function saveDraft({ userId, kind, data, blob = null }) {
    if (!userId) return false;
    try {
        if (!(await openDb())) return false;
        await db.drafts.put({ id: idFor(userId, kind), userId, kind, data, blob, updatedAt: Date.now() });
        emit();
        return true;
    } catch (err) {
        console.warn('[Drafts] could not save draft:', err);
        return false;
    }
}

export async function getDraft(userId, kind) {
    if (!userId) return null;
    try {
        if (!(await openDb())) return null;
        return (await db.drafts.get(idFor(userId, kind))) || null;
    } catch {
        return null;
    }
}

export async function deleteDraft(userId, kind) {
    if (!userId) return;
    try {
        if (!(await openDb())) return;
        await db.drafts.delete(idFor(userId, kind));
        emit();
    } catch (err) {
        console.warn('[Drafts] could not delete draft:', err);
    }
}

export async function listDrafts(userId) {
    try {
        if (!userId || !(await openDb())) return [];
        return await db.drafts.where('userId').equals(userId).toArray();
    } catch {
        return [];
    }
}
