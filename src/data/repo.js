/**
 * Local-first repository: every read comes from the Dexie mirror, every write is applied to the
 * mirror and queued in the outbox in one transaction, then flushed straight away when online.
 *
 * If IndexedDB is unavailable (private mode, blocked storage) the repo falls back to talking to
 * Supabase directly (reads and writes) so the app still works online.
 *
 * Records are app-format (camelCase); see api.js for the column mapping.
 */
import { db, openDb, STORES } from './db';
import * as api from './api';
import { enqueue, requestFlush } from './sync';
import { removeImage } from './images';
import {
    buildCompletedReceiptFromSource,
    buildDoneTrackingData,
    buildOpenTrackingData,
    normalizeTrackingData,
} from '../utils/tracking';
import { calculateNextRecurringDate } from '../utils/recurring';
import { normalizeCategoryName } from '../utils/categoryNames';
import { merchantKey as computeMerchantKey } from '../utils/merchant';
import { computeBase, needsBase } from '../utils/baseAmount';
import { getRateInfo } from '../services/exchangeRateService';
import { estimatedPatch, isConfirmed, pendingPatch } from '../utils/fx';
import { markEdited } from '../utils/extractionMerge';

const nowIso = () => new Date().toISOString();
const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

async function mirrorOk() {
    return openDb();
}

/**
 * Read-side category mapping (v14 rename). Mirrors written before the migration was deployed still hold
 * Restaurant/Healthcare/Transportation/Gas; they are shown with the new names (nothing is written back).
 */
export function normalizeTransaction(tx) {
    if (!tx) return tx;
    const category = normalizeCategoryName(tx.category);
    const items = Array.isArray(tx.lineItems) && tx.lineItems.some((it) => it && normalizeCategoryName(it.category) !== it.category)
        ? tx.lineItems.map((it) => (it && it.category ? { ...it, category: normalizeCategoryName(it.category) } : it))
        : tx.lineItems;
    // Lazy backfill: rows saved before merchantKey existed get it computed on read (persisted by the next write, see updateTransaction)
    const key = tx.merchantKey || (tx.transactionType === 'transfer' || !tx.merchant ? tx.merchantKey : computeMerchantKey(tx.merchant) || tx.merchantKey);
    return category === tx.category && items === tx.lineItems && key === tx.merchantKey ? tx : { ...tx, category, lineItems: items, merchantKey: key };
}

const byDateDesc = (a, b) => {
    const d = String(b.date || '').localeCompare(String(a.date || ''));
    if (d !== 0) return d;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
};

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/** Apply a record insert: mirror + outbox atomically (or direct API when there is no mirror). */
async function insertRecord(table, record) {
    if (!(await mirrorOk())) {
        await api.insert(table, record);
        return record;
    }
    await db.transaction('rw', db[table], db.outbox, async () => {
        await db[table].put(record);
        await enqueue({ table, op: 'insert', recordId: record[STORES[table].pk], userId: record.userId, payload: record, ts: record.updatedAt });
    });
    requestFlush(record.userId);
    return record;
}

/** `derive(existing)` may return extra fields computed from the stored row inside the same local transaction. */
async function patchRecord(table, id, patch, { derive } = {}) {
    const updates = { ...patch, updatedAt: nowIso() };
    if (!(await mirrorOk())) {
        await api.update(table, id, updates);
        return { id, ...updates };
    }
    let merged = null;
    let userId = null;
    await db.transaction('rw', db[table], db.outbox, async () => {
        const existing = await db[table].get(id);
        if (!existing) throw new Error('Record not found');
        Object.assign(updates, derive ? derive(existing) : null);
        merged = { ...existing, ...updates };
        userId = existing.userId;
        await db[table].put(merged);
        await enqueue({ table, op: 'update', recordId: id, userId, payload: updates, ts: updates.updatedAt });
    });
    requestFlush(userId);
    return merged;
}

async function deleteRecord(table, id) {
    if (!(await mirrorOk())) {
        if (table === 'groups') await api.removeGroup(id);
        else await api.remove(table, id);
        return;
    }
    let userId = null;
    await db.transaction('rw', db[table], db.outbox, async () => {
        const existing = await db[table].get(id);
        userId = existing?.userId;
        await db[table].delete(id);
        await enqueue({ table, op: 'delete', recordId: id, userId, ts: nowIso() });
    });
    requestFlush(userId);
}

// ---------------------------------------------------------------------------
// Transactions (Supabase table `receipts`)
// ---------------------------------------------------------------------------

export async function listTransactions(userId, { month } = {}) {
    let rows;
    if (await mirrorOk()) {
        rows = await db.transactions.where('userId').equals(userId).toArray();
    } else {
        rows = await api.fetchSince('transactions', userId, null);
    }
    if (month) rows = rows.filter((r) => String(r.date || '').slice(0, 7) === month);
    return rows.map(normalizeTransaction).sort(byDateDesc);
}

export async function getTransaction(id) {
    if (await mirrorOk()) return normalizeTransaction((await db.transactions.get(id)) || null);
    return null;
}

export async function createTransaction(receipt) {
    if (!receipt?.userId) throw new Error('userId is required to create a transaction');
    const now = nowIso();
    const record = {
        ...receipt,
        id: receipt.id || newId(),
        currency: receipt.currency || 'EUR',
        lineItems: receipt.lineItems || [],
        isDemo: receipt.isDemo || false,
        isPinned: receipt.isPinned || false,
        transactionType: receipt.transactionType || 'expense',
        groupId: receipt.groupId || null,
        groupName: receipt.groupName || null,
        groupTags: receipt.groupTags || [],
        splitData: receipt.splitData || null,
        recurringData: receipt.recurringData || null,
        trackingData: normalizeTrackingData(receipt.trackingData),
        createdAt: now,
        updatedAt: now,
    };
    if (typeof record.total === 'string') record.total = parseFloat(record.total);
    if (!record.merchantKey && record.transactionType !== 'transfer' && record.merchant) record.merchantKey = computeMerchantKey(record.merchant) || undefined;
    if (record.amountBase === undefined || record.amountBase === null) Object.assign(record, await baseFor(record.userId, record));
    await insertRecord('transactions', record);
    return record.id;
}

/**
 * Update a transaction. Edits made by the user are recorded per field (extraction.editedAt) so a later scan result
 * cannot overwrite them; callers that apply a scan result or other system changes pass `{ system: true }`.
 */
export async function updateTransaction(id, updates, { system = false } = {}) {
    const patch = { ...updates };
    delete patch.id;
    delete patch.userId;
    if (patch.trackingData !== undefined) patch.trackingData = normalizeTrackingData(patch.trackingData);
    await withMerchantKey(id, patch);
    await withBaseAmount(id, patch);
    await patchRecord('transactions', id, patch, {
        derive: system
            ? undefined
            : (existing) => {
                  const extraction = markEdited(existing, patch);
                  return extraction ? { extraction } : null;
              },
    });
    return id;
}

/** Re-apply a stored local change on top of the server version (conflict resolution "keep mine"). */
export const patchRecordForSync = (table, id, patch) => {
    const { id: _id, userId: _userId, updatedAt: _updatedAt, ...rest } = patch || {};
    return patchRecord(table, id, rest);
};

/** True when a write failed because the device is out of storage (IndexedDB quota). */
export const isStorageFullError = (err) => err?.name === 'QuotaExceededError' || /quota|storage.*full|disk.*full/i.test(String(err?.message || ''));

// ---------------------------------------------------------------------------
// Base-currency amounts (P4-T2): computed at write time, recomputed when total/currency change
// ---------------------------------------------------------------------------

async function baseCurrencyOf(userId) {
    if (!(await mirrorOk())) return 'EUR';
    return (await db.settings.get(userId))?.defaultCurrency || 'EUR';
}

/**
 * { amountBase, baseCurrency, exchangeRate, extraction? } for a transaction-like { total, currency } in the user's base currency.
 * A foreign currency gets its conversion provenance in `extraction.fx` (estimated with the rate and its date, or pending when no
 * rate is known: offline with nothing cached). Never 1:1.
 */
async function baseFor(userId, tx, { baseCurrency } = {}) {
    const base = baseCurrency || (await baseCurrencyOf(userId));
    const currency = tx.currency || 'EUR';
    if (currency === base) return computeBase({ total: tx.total, currency, baseCurrency: base, rate: 1 });
    const info = await getRateInfo(currency, base);
    const withCurrency = { ...tx, currency };
    return info ? estimatedPatch(withCurrency, { baseCurrency: base, rate: info.rate, date: info.date, source: info.source }) : pendingPatch(withCurrency);
}

async function withBaseAmount(id, patch) {
    if (patch.amountBase !== undefined || !(await mirrorOk())) return;
    const existing = await db.transactions.get(id);
    if (!existing) return;
    // Only a real change of amount or currency re-converts. Saving a record again, or editing its notes, never revalues it:
    // history keeps the conversion it was saved with (confirmed charges included).
    const total = patch.total !== undefined ? (typeof patch.total === 'string' ? parseFloat(patch.total) : patch.total) : existing.total;
    const currency = patch.currency ?? existing.currency;
    const changed = (patch.total !== undefined && Number(total) !== Number(existing.total)) || (patch.currency !== undefined && patch.currency !== existing.currency);
    if (!changed && existing.amountBase !== null && existing.amountBase !== undefined) return;
    if (!changed && !needsBase(existing, await baseCurrencyOf(existing.userId))) return;
    Object.assign(patch, await baseFor(existing.userId, { total, currency, extraction: patch.extraction ?? existing.extraction }));
}

/**
 * Fill base amounts that were left null (saved offline without a cached rate). Called after each sync.
 * Only foreign-currency rows need it; returns how many rows were updated.
 */
export async function fillMissingBaseAmounts(userId) {
    if (!userId || !(await mirrorOk())) return 0;
    const base = await baseCurrencyOf(userId);
    const rows = (await db.transactions.where('userId').equals(userId).toArray()).filter((tx) => needsBase(tx, base));
    const changes = [];
    for (const tx of rows) {
        const b = await baseFor(userId, tx, { baseCurrency: base });
        if (b.amountBase !== null) changes.push({ id: tx.id, patch: b });
    }
    await batchUpdateTransactions(changes);
    return changes.length;
}

/** Settings > Data > "Recalculate base amounts": every row, current base currency, today's rate. */
export async function recalculateBaseAmounts(userId) {
    if (!userId || !(await mirrorOk())) return { updated: 0, skipped: 0 };
    const base = await baseCurrencyOf(userId);
    const rows = await db.transactions.where('userId').equals(userId).toArray();
    const changes = [];
    let skipped = 0;
    for (const tx of rows) {
        if (isConfirmed(tx)) {
            skipped += 1; // the amount actually charged is never revalued
            continue;
        }
        const b = await baseFor(userId, tx, { baseCurrency: base });
        if (b.amountBase === null) {
            skipped += 1; // no rate available: keep what is stored
            continue;
        }
        if (b.amountBase !== tx.amountBase || b.baseCurrency !== tx.baseCurrency || b.exchangeRate !== tx.exchangeRate) changes.push({ id: tx.id, patch: b });
    }
    await batchUpdateTransactions(changes);
    return { updated: changes.length, skipped };
}

/** Keep merchantKey in step with the merchant, and persist it for rows that were saved without one (lazy backfill). */
async function withMerchantKey(id, patch) {
    if (patch.merchantKey !== undefined || !(await mirrorOk())) return;
    const existing = await db.transactions.get(id);
    if (!existing) return;
    const type = patch.transactionType ?? existing.transactionType;
    const merchant = patch.merchant !== undefined ? patch.merchant : existing.merchant;
    if (type === 'transfer' || !merchant) return;
    if (existing.merchantKey && patch.merchant === undefined) return;
    const key = computeMerchantKey(merchant);
    if (key && key !== existing.merchantKey) patch.merchantKey = key;
}

/**
 * Apply several transaction patches in one local transaction (one outbox pass). Returns the previous values of
 * the patched fields so the caller can undo with another batch: [{ id, patch }].
 */
export async function batchUpdateTransactions(changes) {
    if (!changes?.length) return [];
    if (!(await mirrorOk())) {
        const previous = [];
        for (const { id, patch } of changes) {
            await patchRecord('transactions', id, patch);
        }
        return previous;
    }
    const previous = [];
    const users = new Set();
    const ts = nowIso();
    await db.transaction('rw', db.transactions, db.outbox, async () => {
        for (const { id, patch } of changes) {
            const existing = await db.transactions.get(id);
            if (!existing) continue;
            const updates = { ...patch, updatedAt: ts };
            previous.push({ id, patch: Object.fromEntries(Object.keys(patch).map((k) => [k, existing[k]])) });
            await db.transactions.put({ ...existing, ...updates });
            await enqueue({ table: 'transactions', op: 'update', recordId: id, userId: existing.userId, payload: updates, ts });
            users.add(existing.userId);
        }
    });
    for (const u of users) requestFlush(u);
    return previous;
}

export async function deleteTransaction(id) {
    const existing = await getTransaction(id);
    // A record whose insert never left this device has no server photo either: cancelling it must leave nothing queued.
    const neverSent = (await mirrorOk()) && (await db.outbox.where('recordId').equals(id).toArray()).some((e) => e.table === 'transactions' && e.op === 'insert' && e.status === 'pending' && !e.attempted);
    await deleteRecord('transactions', id);
    // The receipt photo goes with the transaction (queued when offline)
    if (existing?.imagePath || (await hasQueuedImage(id))) {
        await removeImage({ userId: existing?.userId, transactionId: id, imagePath: existing?.imagePath || null, neverUploaded: neverSent });
    }
}

async function hasQueuedImage(id) {
    try {
        return !!(await db.images.get(id));
    } catch {
        return false;
    }
}

/** Mark a tracked (planned/unpaid) transaction as done; recurring ones roll forward to the next date. */
export async function markTransactionDone(id) {
    const receipt = await getTransaction(id);
    if (!receipt) throw new Error('Receipt not found');

    const trackingData = normalizeTrackingData(receipt.trackingData);
    if (!trackingData?.isTracked) throw new Error('Receipt is not enabled for mark as done');
    if (trackingData.status === 'done') return receipt;

    const completedAt = nowIso();

    if (receipt.recurringData?.isActive) {
        const nextDate = calculateNextRecurringDate(receipt.date, receipt.recurringData.frequency);
        await createTransaction(buildCompletedReceiptFromSource(receipt, completedAt));
        await updateTransaction(id, {
            date: nextDate,
            recurringData: { ...receipt.recurringData, nextDueDate: nextDate },
            trackingData: buildOpenTrackingData(trackingData),
        });
        return getTransaction(id);
    }

    await updateTransaction(id, { trackingData: buildDoneTrackingData(trackingData, completedAt) });
    return getTransaction(id);
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

export async function countDemoTransactions(userId) {
    return (await listTransactions(userId)).filter((r) => r.isDemo).length;
}

export async function seedDemoData(userId) {
    if ((await countDemoTransactions(userId)) > 0) return { importedCount: 0, alreadyExists: true };
    const day = 86400000;
    const demo = [
        { merchant: 'Grocery Store', total: 85.5, category: 'Groceries', date: new Date().toISOString() },
        { merchant: 'Gas Station', total: 45.0, category: 'Fuel', date: new Date(Date.now() - day).toISOString() },
        { merchant: 'Restaurant', total: 32.75, category: 'Dining', date: new Date(Date.now() - 2 * day).toISOString() },
        { merchant: 'Amazon', total: 129.99, category: 'Shopping', date: new Date(Date.now() - 3 * day).toISOString() },
        { merchant: 'Electric Company', total: 95.0, category: 'Utilities', date: new Date(Date.now() - 4 * day).toISOString() },
    ];
    for (const r of demo) {
        await createTransaction({ userId, ...r, currency: 'EUR', isDemo: true, lineItems: [] });
    }
    return { importedCount: demo.length, alreadyExists: false };
}

export async function clearDemoData(userId) {
    const demo = (await listTransactions(userId)).filter((r) => r.isDemo);
    for (const r of demo) await deleteTransaction(r.id);
    return demo.length;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export async function listGroups(userId) {
    let rows;
    if (await mirrorOk()) rows = await db.groups.where('userId').equals(userId).toArray();
    else rows = await api.fetchSince('groups', userId, null);
    return rows.sort((a, b) => {
        if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

export async function getGroup(id) {
    if (await mirrorOk()) return (await db.groups.get(id)) || null;
    return null;
}

/** Returns the created group record. */
export async function createGroup(userId, data = {}) {
    if (!userId) throw new Error('userId is required to create a group');
    const now = nowIso();
    const record = {
        ...data,
        id: data.id || newId(),
        userId,
        name: data.name,
        color: data.color || '#6366f1',
        isPinned: data.isPinned || false,
        isDemo: data.isDemo || false,
        parentGroupId: data.parentGroupId || null,
        createdAt: now,
        updatedAt: now,
    };
    await insertRecord('groups', record);
    return record;
}

export async function updateGroup(id, updates) {
    const patch = { ...updates };
    delete patch.id;
    delete patch.userId;
    await patchRecord('groups', id, patch);
    return id;
}

/**
 * Delete a group. Its receipts move to the parent group (nested group) or are ungrouped, in the mirror
 * immediately and on the server as part of the delete.
 */
export async function deleteGroup(id) {
    const group = await getGroup(id);
    if (await mirrorOk()) {
        const parent = group?.parentGroupId ? await getGroup(group.parentGroupId) : null;
        const affected = await db.transactions.where('groupId').equals(id).toArray();
        await db.transactions.bulkPut(
            affected.map((r) =>
                parent
                    ? { ...r, groupId: parent.id, groupName: parent.name }
                    : { ...r, groupId: null, groupName: null, groupTags: [] }
            )
        );
    }
    await deleteRecord('groups', id);
}

// ---------------------------------------------------------------------------
// Categories (Supabase table `user_categories`)
// ---------------------------------------------------------------------------

export async function listCategories(userId) {
    let rows;
    if (await mirrorOk()) rows = await db.categories.where('userId').equals(userId).toArray();
    else rows = await api.fetchSince('categories', userId, null);
    const seen = new Set();
    return rows
        .map((c) => ({ ...c, name: normalizeCategoryName(c.name) }))
        .filter((c) => (seen.has(c.name) ? false : seen.add(c.name)))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export async function createCategory(userId, data) {
    if (await mirrorOk()) {
        const existing = (await db.categories.where('userId').equals(userId).toArray()).find((c) => c.name === data.name);
        if (existing) return existing; // names are unique per user (old behaviour: ON CONFLICT DO NOTHING)
    }
    const now = nowIso();
    const record = { id: newId(), userId, name: data.name, color: data.color || '#6366f1', createdAt: now, updatedAt: now };
    await insertRecord('categories', record);
    return record;
}

export async function updateCategory(id, updates) {
    const patch = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.color !== undefined) patch.color = updates.color;
    await patchRecord('categories', id, patch);
    return id;
}

export async function deleteCategory(id) {
    await deleteRecord('categories', id);
}

// ---------------------------------------------------------------------------
// Settings and dashboard layout (one row per user)
// ---------------------------------------------------------------------------

export async function getSettings(userId) {
    if (await mirrorOk()) return (await db.settings.get(userId)) || null;
    const rows = await api.fetchSince('settings', userId, null);
    return rows[0] || null;
}

/** Merge `patch` into the user's settings. */
export async function saveSettings(userId, patch) {
    const existing = (await getSettings(userId)) || { userId };
    const record = {
        ...existing,
        ocrApiKey: existing.ocrApiKey ?? null,
        defaultCurrency: existing.defaultCurrency ?? 'EUR',
        languageCode: existing.languageCode ?? null,
        notificationPreferences: existing.notificationPreferences ?? null,
        ...patch,
        userId,
        updatedAt: nowIso(),
    };
    await upsertSingleton('settings', record);
    return record;
}

export async function getLayout(userId) {
    if (await mirrorOk()) return (await db.layouts.get(userId)) || null;
    const rows = await api.fetchSince('layouts', userId, null).catch(() => []);
    return rows[0] || null;
}

export async function saveLayout(userId, layout) {
    const record = { userId, layout, updatedAt: nowIso() };
    await upsertSingleton('layouts', record);
    return record;
}

async function upsertSingleton(table, record) {
    if (!(await mirrorOk())) {
        await api.upsert(table, record);
        return;
    }
    await db.transaction('rw', db[table], db.outbox, async () => {
        await db[table].put(record);
        await enqueue({ table, op: 'upsert', recordId: record.userId, userId: record.userId, payload: record, ts: record.updatedAt });
    });
    requestFlush(record.userId);
}

// ---------------------------------------------------------------------------
// v13 tables (accounts, budgets, goals, rules): generic row access
// ---------------------------------------------------------------------------

export async function listRows(table, userId, filter) {
    let rows = (await mirrorOk()) ? await db[table].where('userId').equals(userId).toArray() : [];
    if (filter) rows = rows.filter(filter);
    return rows;
}

export async function createRow(table, userId, data) {
    const now = nowIso();
    const record = { ...data, id: data.id || newId(), userId, createdAt: now, updatedAt: now };
    await insertRecord(table, record);
    return record;
}

export async function updateRow(table, id, patch) {
    return patchRecord(table, id, patch);
}

export async function deleteRow(table, id) {
    return deleteRecord(table, id);
}


// ---------------------------------------------------------------------------
// Assistant chat history (v15): chatConversations + chatMessages. Reads are keyset-paged straight from the Dexie indexes
// ([userId+updatedAt], [conversationId+createdAt]; equal keys fall back to the primary key), so the UI never loads a whole
// table. Deletes are soft (`deletedAt`) so other devices learn about them through the pull.
// ---------------------------------------------------------------------------

export const CONVERSATION_PAGE = 20;
export const MESSAGE_PAGE = 30;
export const CHAT_TITLE_MAX = 60;
const KEY_LOW = '';
const KEY_HIGH = '￿';

export const chatTitle = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_TITLE_MAX).trimEnd();
const cursorOf = (row) => (row ? { createdAt: row.createdAt, updatedAt: row.updatedAt, id: row.id } : null);

/** Conversations strictly older than `after` ({ updatedAt, id }), newest first, not deleted. -> { items, next } */
export async function listConversationsPage(userId, { limit = CONVERSATION_PAGE, after = null } = {}) {
    if (!(await mirrorOk())) return { items: [], next: null };
    const upper = after ? after.updatedAt : KEY_HIGH;
    const rows = await db.chatConversations
        .where('[userId+updatedAt]')
        .between([userId, KEY_LOW], [userId, upper], true, true)
        .reverse()
        .filter((c) => !c.deletedAt && (!after || c.updatedAt < after.updatedAt || (c.updatedAt === after.updatedAt && c.id < after.id)))
        .limit(limit + 1)
        .toArray();
    const page = rows.slice(0, limit);
    const items = await Promise.all(
        page.map(async (c) => ({ ...c, messageCount: await db.chatMessages.where('conversationId').equals(c.id).filter((m) => !m.deletedAt).count() }))
    );
    return { items, next: rows.length > limit ? cursorOf(page[page.length - 1]) : null };
}

export async function getConversation(id) {
    if (!(await mirrorOk())) return null;
    const c = await db.chatConversations.get(id);
    return c && !c.deletedAt ? c : null;
}

/** Messages strictly before `before` ({ createdAt, id }) or the newest ones; returned oldest first. -> { items, hasOlder } */
export async function listMessagesPage(conversationId, { limit = MESSAGE_PAGE, before = null } = {}) {
    if (!(await mirrorOk())) return { items: [], hasOlder: false };
    const upper = before ? before.createdAt : KEY_HIGH;
    const rows = await db.chatMessages
        .where('[conversationId+createdAt]')
        .between([conversationId, KEY_LOW], [conversationId, upper], true, true)
        .reverse()
        .filter((m) => !m.deletedAt && (!before || m.createdAt < before.createdAt || (m.createdAt === before.createdAt && m.id < before.id)))
        .limit(limit + 1)
        .toArray();
    return { items: rows.slice(0, limit).reverse(), hasOlder: rows.length > limit };
}

/** Every message from `anchor` ({ createdAt, id }, inclusive) to the newest, oldest first: the pages the reader has scrolled back to. */
export async function listMessagesFrom(conversationId, anchor) {
    if (!(await mirrorOk())) return { items: [], hasOlder: false };
    const items = await db.chatMessages
        .where('[conversationId+createdAt]')
        .between([conversationId, anchor.createdAt], [conversationId, KEY_HIGH], true, true)
        .filter((m) => !m.deletedAt && (m.createdAt > anchor.createdAt || m.id >= anchor.id))
        .toArray();
    const older = await listMessagesPage(conversationId, { limit: 1, before: anchor });
    return { items, hasOlder: older.items.length > 0 };
}

export async function createConversation(userId, { id, title = '' } = {}) {
    if (!userId) throw new Error('userId is required to create a conversation');
    const now = nowIso();
    const record = { id: id || newId(), userId, title: chatTitle(title) || null, createdAt: now, updatedAt: now, deletedAt: null };
    await insertRecord('chatConversations', record);
    return record;
}

/**
 * Append a message and bump the conversation's updatedAt (so the list stays newest first). createdAt is kept strictly
 * increasing inside a conversation: a user message and its answer written in the same millisecond must not swap places.
 */
export async function appendMessage(userId, { id, conversationId, role, content, meta = null } = {}) {
    if (!userId || !conversationId) throw new Error('userId and conversationId are required to append a message');
    if (role !== 'user' && role !== 'assistant') throw new Error('invalid chat role');
    if (!(await mirrorOk())) {
        const now = nowIso();
        const record = { id: id || newId(), userId, conversationId, role, content: String(content ?? ''), meta, createdAt: now, updatedAt: now, deletedAt: null };
        await api.insert('chatMessages', record);
        return record;
    }
    let record = null;
    await db.transaction('rw', db.chatMessages, db.chatConversations, db.outbox, async () => {
        const conv = await db.chatConversations.get(conversationId);
        if (!conv) throw new Error('Conversation not found');
        const last = await db.chatMessages.where('[conversationId+createdAt]').between([conversationId, KEY_LOW], [conversationId, KEY_HIGH], true, true).last();
        let at = Date.now();
        if (last && Date.parse(last.createdAt) >= at) at = Date.parse(last.createdAt) + 1;
        const now = new Date(at).toISOString();
        record = { id: id || newId(), userId, conversationId, role, content: String(content ?? ''), meta, createdAt: now, updatedAt: now, deletedAt: null };
        await db.chatMessages.put(record);
        await enqueue({ table: 'chatMessages', op: 'insert', recordId: record.id, userId, payload: record, ts: now });
        const bumped = { ...conv, updatedAt: now };
        await db.chatConversations.put(bumped);
        await enqueue({ table: 'chatConversations', op: 'update', recordId: conversationId, userId, payload: { updatedAt: now }, ts: now });
    });
    requestFlush(userId);
    return record;
}

export async function renameConversation(id, title) {
    return patchRecord('chatConversations', id, { title: chatTitle(title) || null });
}

/** Soft-delete (or restore, `deletedAt: null`) a set of chat rows in one local transaction. */
async function setChatDeleted(table, ids, deletedAt, userId) {
    const ts = nowIso();
    await db.transaction('rw', db[table], db.outbox, async () => {
        for (const id of ids) {
            const row = await db[table].get(id);
            if (!row) continue;
            await db[table].put({ ...row, deletedAt, updatedAt: ts });
            await enqueue({ table, op: 'update', recordId: id, userId: row.userId || userId, payload: { deletedAt, updatedAt: ts }, ts });
        }
    });
}

/** Soft-delete a conversation and its messages. Resolves to { id, messages } so the caller can offer an undo. */
export async function deleteConversation(id) {
    if (!(await mirrorOk())) {
        await api.update('chatConversations', id, { deletedAt: nowIso() });
        return { id, messages: 0 };
    }
    const conv = await db.chatConversations.get(id);
    if (!conv) return { id, messages: 0 };
    const messageIds = await db.chatMessages.where('conversationId').equals(id).filter((m) => !m.deletedAt).primaryKeys();
    await setChatDeleted('chatMessages', messageIds, nowIso(), conv.userId);
    await setChatDeleted('chatConversations', [id], nowIso(), conv.userId);
    requestFlush(conv.userId);
    return { id, messages: messageIds.length };
}

/** Undo of deleteConversation: brings back the conversation and the messages that were deleted with it. */
export async function restoreConversation(id) {
    if (!(await mirrorOk())) return false;
    const conv = await db.chatConversations.get(id);
    if (!conv) return false;
    const messageIds = await db.chatMessages.where('conversationId').equals(id).filter((m) => !!m.deletedAt).primaryKeys();
    await setChatDeleted('chatConversations', [id], null, conv.userId);
    await setChatDeleted('chatMessages', messageIds, null, conv.userId);
    requestFlush(conv.userId);
    return true;
}

/** Soft-delete all of the user's chat history, in batches (the mirror is never read into memory at once). */
export async function deleteAllConversations(userId) {
    if (!(await mirrorOk())) return 0;
    const BATCH = 100;
    let count = 0;
    const messageIds = await db.chatMessages.where('userId').equals(userId).filter((m) => !m.deletedAt).primaryKeys();
    for (let i = 0; i < messageIds.length; i += BATCH) await setChatDeleted('chatMessages', messageIds.slice(i, i + BATCH), nowIso(), userId);
    const convIds = await db.chatConversations.where('userId').equals(userId).filter((c) => !c.deletedAt).primaryKeys();
    for (let i = 0; i < convIds.length; i += BATCH) await setChatDeleted('chatConversations', convIds.slice(i, i + BATCH), nowIso(), userId);
    count = convIds.length;
    requestFlush(userId);
    return count;
}
