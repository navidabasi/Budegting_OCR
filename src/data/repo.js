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
import { getRate } from '../services/exchangeRateService';

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

async function patchRecord(table, id, patch) {
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

export async function updateTransaction(id, updates) {
    const patch = { ...updates };
    delete patch.id;
    delete patch.userId;
    if (patch.trackingData !== undefined) patch.trackingData = normalizeTrackingData(patch.trackingData);
    await withMerchantKey(id, patch);
    await withBaseAmount(id, patch);
    await patchRecord('transactions', id, patch);
    return id;
}

// ---------------------------------------------------------------------------
// Base-currency amounts (P4-T2): computed at write time, recomputed when total/currency change
// ---------------------------------------------------------------------------

async function baseCurrencyOf(userId) {
    if (!(await mirrorOk())) return 'EUR';
    return (await db.settings.get(userId))?.defaultCurrency || 'EUR';
}

/** { amountBase, baseCurrency, exchangeRate } for a transaction-like { total, currency } in the user's base currency. */
async function baseFor(userId, tx, { baseCurrency } = {}) {
    const base = baseCurrency || (await baseCurrencyOf(userId));
    const currency = tx.currency || 'EUR';
    const rate = currency === base ? 1 : await getRate(currency, base);
    return computeBase({ total: tx.total, currency, baseCurrency: base, rate });
}

async function withBaseAmount(id, patch) {
    if (patch.amountBase !== undefined || !(await mirrorOk())) return;
    const existing = await db.transactions.get(id);
    if (!existing) return;
    const touches = patch.total !== undefined || patch.currency !== undefined;
    if (!touches && existing.amountBase !== null && existing.amountBase !== undefined) return;
    if (!touches && !needsBase(existing, await baseCurrencyOf(existing.userId))) return;
    const total = patch.total !== undefined ? (typeof patch.total === 'string' ? parseFloat(patch.total) : patch.total) : existing.total;
    Object.assign(patch, await baseFor(existing.userId, { total, currency: patch.currency ?? existing.currency }));
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
    await deleteRecord('transactions', id);
    // The receipt photo goes with the transaction (queued when offline)
    if (existing?.imagePath || (await hasQueuedImage(id))) {
        await removeImage({ userId: existing?.userId, transactionId: id, imagePath: existing?.imagePath || null });
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

