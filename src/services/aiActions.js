// Bookkeeping proposals from the assistant (pass 2 part 2, section 6).
//
// The assistant (or the review builder) only PROPOSES. A proposal is previewed in a sheet and applied only after the owner confirms;
// every applied change is written to an undo history that survives restarts (local `meta` store) and can be reverted later.
// Nothing here moves money: there is no payment, transfer or settlement action.
//
//   recategorise      change the category of records (this record only, or the listed records)
//   mark_duplicate    remove the record that duplicates another one (reversible: the full record is kept in the history)
//   create_recurring  mark a charge as recurring (what Detail > Repeats saves)
//   prepare_correction  open the record to correct it by hand (no change is made)
import { batchUpdateTransactions, createTransaction, deleteTransaction, getTransaction } from '../data/repo';
import { getMeta, setMeta } from '../data/db';
import { calculateNextRecurringDate } from '../utils/recurring';
import { displayName, merchantKey } from '../utils/merchant';
import { isSettlement } from '../utils/splits';
import { reviewCandidates } from './evidencePack';

export const PROPOSAL_TYPES = ['recategorise', 'mark_duplicate', 'create_recurring', 'prepare_correction'];
export const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'];
const LOG_LIMIT = 50;
const brief = (tx) => ({ id: tx.id, merchant: displayName(tx.merchant) || tx.merchant || '', date: String(tx.date || '').slice(0, 10), amount: Number(tx.total) || 0, currency: tx.currency || 'EUR', category: tx.category || '' });

const uid = (() => {
    let i = 0;
    return () => `p${Date.now().toString(36)}${(i++).toString(36)}`;
})();

/** Can this record be removed as a duplicate and brought back exactly? Photos and shared/settled records are never removed by a proposal. */
export function removableAsDuplicate(tx, transactions = []) {
    if (!tx || tx.imagePath || tx.isDemo || isSettlement(tx) || tx.splitData || tx.extraction?.pending) return false;
    return !transactions.some((o) => o.splitData?.settles?.includes?.(tx.id));
}

// ---------------------------------------------------------------------------
// Where proposals come from
// ---------------------------------------------------------------------------
/**
 * Turn the model's proposals (evidence ids) into previewable ones. Everything is re-checked against the records on the device:
 * unknown ids, categories that do not exist, duplicates that are not really duplicates are dropped.
 */
export function resolveProposals(raw, refs, transactions, { categories = [] } = {}) {
    const byId = new Map(transactions.map((t) => [t.id, t]));
    const tx = (ref) => byId.get(refs?.[ref]?.txId);
    const out = [];
    for (const p of Array.isArray(raw) ? raw : []) {
        const a = tx(p.ref);
        if (!a || !PROPOSAL_TYPES.includes(p.type)) continue;
        if (p.type === 'recategorise') {
            if (!categories.includes(p.category) || a.category === p.category || a.transactionType === 'transfer') continue;
            out.push({ id: uid(), type: p.type, source: 'ai', category: p.category, records: [brief(a)], note: p.note || '' });
        } else if (p.type === 'mark_duplicate') {
            const b = tx(p.toRef);
            if (!b || a.id === b.id || !removableAsDuplicate(a, transactions)) continue;
            const sameAmount = Math.abs((Number(a.total) || 0) - (Number(b.total) || 0)) < 0.011;
            const near = Math.abs(new Date(`${String(a.date).slice(0, 10)}T00:00:00Z`) - new Date(`${String(b.date).slice(0, 10)}T00:00:00Z`)) <= 3 * 86400000;
            if (!sameAmount || !near || (a.transactionType || 'expense') !== (b.transactionType || 'expense')) continue;
            out.push({ id: uid(), type: p.type, source: 'ai', remove: brief(a), keep: brief(b), note: p.note || '' });
        } else if (p.type === 'create_recurring') {
            if (a.recurringData?.isActive || (a.transactionType || 'expense') !== 'expense') continue;
            out.push({ id: uid(), type: p.type, source: 'ai', frequency: FREQUENCIES.includes(p.frequency) ? p.frequency : 'monthly', records: [brief(a)], note: p.note || '' });
        } else {
            out.push({ id: uid(), type: 'prepare_correction', source: 'ai', record: brief(a), note: p.note || '' });
        }
    }
    return out;
}

/**
 * Proposals computed from the review lists, without the model: uncategorised records grouped by merchant where a rule or
 * history suggests a category, probable duplicates, subscription-like charges, receipts whose items do not add up.
 * `suggest(tx)` returns a category name or null (the app's categorizer).
 */
export function localProposals(transactions, { period, today, suggest = () => null, categories = [] } = {}) {
    const c = reviewCandidates(transactions, { period, today });
    const out = [];
    const groups = new Map();
    for (const tx of c.uncategorised) {
        const key = tx.merchantKey || merchantKey(tx.merchant);
        const cat = suggest(tx);
        if (!key || !cat || !categories.includes(cat) || cat === tx.category) continue;
        const g = groups.get(`${key}|${cat}`) || { category: cat, records: [] };
        g.records.push(brief(tx));
        groups.set(`${key}|${cat}`, g);
    }
    for (const g of groups.values()) out.push({ id: uid(), type: 'recategorise', source: 'local', category: g.category, records: g.records });
    for (const d of c.dupes) if (removableAsDuplicate(d.remove, transactions)) out.push({ id: uid(), type: 'mark_duplicate', source: 'local', remove: brief(d.remove), keep: brief(d.keep) });
    for (const s of c.subscriptions.slice(0, 3)) {
        const last = transactions.filter((t) => (t.merchantKey || merchantKey(t.merchant)) === s.key && !t.recurringData).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
        if (last) out.push({ id: uid(), type: 'create_recurring', source: 'local', frequency: 'monthly', records: [brief(last)] });
    }
    for (const t of c.mismatched.slice(0, 2)) out.push({ id: uid(), type: 'prepare_correction', source: 'local', record: brief(t) });
    return out;
}

export const proposalHref = (p) => (p.type === 'prepare_correction' ? `/receipts/${p.record.id}` : null);

// ---------------------------------------------------------------------------
// History (survives restarts) and apply / undo
// ---------------------------------------------------------------------------
const logKey = (userId) => `aiActionLog:${userId}`;

export async function loadLog(userId) {
    try {
        const v = await getMeta(logKey(userId), []);
        return Array.isArray(v) ? v : [];
    } catch {
        return [];
    }
}

async function appendLog(userId, entry) {
    const log = [entry, ...(await loadLog(userId))].slice(0, LOG_LIMIT);
    await setMeta(logKey(userId), log);
    return log;
}

async function patchLog(userId, id, patch) {
    const log = (await loadLog(userId)).map((e) => (e.id === id ? { ...e, ...patch } : e));
    await setMeta(logKey(userId), log);
    return log;
}

/**
 * Apply a confirmed proposal. Returns the history entry. Throws if nothing could be applied (nothing is logged then).
 * The previous values (or the whole removed record) are stored in the entry, so undoEntry() can restore them exactly.
 */
export async function applyProposal(userId, proposal) {
    const at = new Date().toISOString();
    let entry;
    if (proposal.type === 'recategorise') {
        const previous = await batchUpdateTransactions(proposal.records.map((r) => ({ id: r.id, patch: { category: proposal.category } })));
        if (previous.length === 0) throw new Error('Nothing to change');
        entry = { id: uid(), at, type: proposal.type, count: previous.length, category: proposal.category, label: proposal.records.map((r) => r.merchant).slice(0, 3).join(', '), previous, status: 'applied' };
    } else if (proposal.type === 'create_recurring') {
        const rows = [];
        for (const r of proposal.records) {
            const tx = await getTransaction(r.id);
            if (tx) rows.push({ id: tx.id, patch: { recurringData: { isActive: true, frequency: proposal.frequency, nextDueDate: calculateNextRecurringDate(tx.date, proposal.frequency), endDate: null, reminderDays: 3 } } });
        }
        const previous = await batchUpdateTransactions(rows);
        if (previous.length === 0) throw new Error('Nothing to change');
        entry = { id: uid(), at, type: proposal.type, count: previous.length, frequency: proposal.frequency, label: proposal.records.map((r) => r.merchant).slice(0, 3).join(', '), previous, status: 'applied' };
    } else if (proposal.type === 'mark_duplicate') {
        const tx = await getTransaction(proposal.remove.id);
        const keep = await getTransaction(proposal.keep.id);
        if (!tx || !keep) throw new Error('Record not found');
        if (!removableAsDuplicate(tx)) throw new Error('This record cannot be removed automatically');
        await deleteTransaction(tx.id);
        entry = { id: uid(), at, type: proposal.type, count: 1, label: proposal.remove.merchant, removed: tx, keptId: keep.id, status: 'applied' };
    } else {
        throw new Error('This proposal opens a record; it changes nothing');
    }
    await appendLog(userId, entry);
    return entry;
}

/** Revert an applied entry: previous values go back, a removed duplicate is re-created with its original id. */
export async function undoEntry(userId, entryId) {
    const entry = (await loadLog(userId)).find((e) => e.id === entryId);
    if (!entry || entry.status !== 'applied') return null;
    if (entry.type === 'mark_duplicate') await createTransaction(entry.removed);
    else await batchUpdateTransactions(entry.previous || []);
    await patchLog(userId, entryId, { status: 'undone', undoneAt: new Date().toISOString() });
    return entry;
}
