/**
 * Thin Supabase CRUD per table plus the camelCase <-> snake_case mappers.
 *
 * The rest of the data layer (repo/sync/hooks) works with app-format (camelCase) records;
 * only this module knows column names. To add a column to a synced table follow
 * section 8 of docs/IMPROVEMENT_PLAN.md: add it to the field list below (both directions
 * come from the same list) and extend the round-trip test in src/data/__tests__/mappers.test.js.
 */
import { supabase } from '../services/supabaseService';
import { normalizeTrackingData } from '../utils/tracking';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUUID = (v) => typeof v === 'string' && UUID_RE.test(v);

// ---------------------------------------------------------------------------
// Field lists. Options:
//   default   value used when the app value is missing/empty (write) or null (read)
//   num       parse numeric strings (Postgres numeric columns arrive as strings)
//   uuid      invalid UUIDs are written as null (temporary client-side group ids)
//   optional  v13 columns: only written when not null, only read when present
//   noWrite   never sent to the server (server-generated)
//   norm      normalise function applied in both directions
// ---------------------------------------------------------------------------
const F = (app, col, opts = {}) => ({ app, col, ...opts });

const TRANSACTION_FIELDS = [
    F('id', 'id'),
    F('userId', 'user_id'),
    F('merchant', 'merchant'),
    F('date', 'date'),
    F('total', 'total', { num: true }),
    F('currency', 'currency', { default: 'EUR' }),
    F('category', 'category'),
    F('notes', 'notes'),
    F('lineItems', 'line_items', { default: [] }),
    F('isDemo', 'is_demo', { default: false }),
    F('isPinned', 'is_pinned', { default: false }),
    F('transactionType', 'transaction_type', { default: 'expense' }),
    F('groupId', 'group_id', { uuid: true, default: null }),
    F('groupName', 'group_name', { default: null }),
    F('groupTags', 'group_tags', { default: [] }),
    F('splitData', 'split_data', { default: null }),
    F('recurringData', 'recurring_data', { default: null }),
    F('trackingData', 'tracking_data', { norm: (v) => normalizeTrackingData(v || null), default: null }),
    F('createdAt', 'created_at'),
    F('updatedAt', 'updated_at'),
    // v13 (supabase/migrations/20261110_v13_accounts_budgets_goals.sql)
    F('accountId', 'account_id', { optional: true }),
    F('toAccountId', 'to_account_id', { optional: true }),
    F('imagePath', 'image_path', { optional: true }),
    F('amountBase', 'amount_base', { optional: true, num: true }),
    F('baseCurrency', 'base_currency', { optional: true }),
    F('exchangeRate', 'exchange_rate', { optional: true, num: true }),
    F('merchantKey', 'merchant_key', { optional: true }),
    F('goalId', 'goal_id', { optional: true }),
    F('importRef', 'import_ref', { optional: true }),
    F('extraction', 'extraction', { optional: true }),
];

const GROUP_FIELDS = [
    F('id', 'id'),
    F('userId', 'user_id'),
    F('name', 'name'),
    F('color', 'color', { default: '#3b82f6' }),
    F('isPinned', 'is_pinned', { default: false }),
    F('isDemo', 'is_demo', { default: false }),
    F('parentGroupId', 'parent_group_id', { default: null }),
    F('createdAt', 'created_at'),
    F('updatedAt', 'updated_at'),
    // v13 trip columns
    F('kind', 'kind', { optional: true }),
    F('startsOn', 'starts_on', { optional: true }),
    F('endsOn', 'ends_on', { optional: true }),
    F('budgetAmount', 'budget_amount', { optional: true, num: true }),
    F('currency', 'currency', { optional: true }),
    F('isActive', 'is_active', { optional: true }),
    F('excludeFromBudgets', 'exclude_from_budgets', { optional: true }),
    F('companions', 'companions', { optional: true }),
];

const CATEGORY_FIELDS = [
    F('id', 'id'),
    F('userId', 'user_id'),
    F('name', 'name'),
    F('color', 'color', { default: null }),
    F('createdAt', 'created_at'),
    F('updatedAt', 'updated_at'),
];

// OCR key column is still called veryfi_api_key (legacy name, see plan section 2.6).
const SETTINGS_FIELDS = [
    F('id', 'id', { noWrite: true }),
    F('userId', 'user_id'),
    F('ocrApiKey', 'veryfi_api_key', { default: null }),
    F('defaultCurrency', 'default_currency', { default: 'EUR' }),
    F('languageCode', 'language_code', { default: null }),
    F('notificationPreferences', 'notification_preferences', {
        default: null,
        norm: (v) => {
            if (typeof v === 'string') {
                try {
                    return JSON.parse(v);
                } catch {
                    return null;
                }
            }
            return v || null;
        },
    }),
    F('createdAt', 'created_at', { noWrite: true }),
    F('updatedAt', 'updated_at'),
];

const LAYOUT_FIELDS = [
    F('id', 'id', { noWrite: true }),
    F('userId', 'user_id'),
    F('layout', 'layout', { default: null }),
    F('createdAt', 'created_at', { noWrite: true }),
    F('updatedAt', 'updated_at'),
];

const ACCOUNT_FIELDS = [
    F('id', 'id'),
    F('userId', 'user_id'),
    F('name', 'name'),
    F('kind', 'kind'),
    F('currency', 'currency', { default: 'EUR' }),
    F('openingBalance', 'opening_balance', { num: true, default: 0 }),
    F('openingDate', 'opening_date'),
    F('color', 'color'),
    F('icon', 'icon'),
    F('isArchived', 'is_archived', { default: false }),
    F('sortOrder', 'sort_order', { default: 0 }),
    F('counterparty', 'counterparty', { optional: true }), // debt / receivable accounts: who owes whom
    F('createdAt', 'created_at'),
    F('updatedAt', 'updated_at'),
];

const BUDGET_FIELDS = [
    F('id', 'id'),
    F('userId', 'user_id'),
    F('category', 'category'),
    F('amount', 'amount', { num: true }),
    F('currency', 'currency', { default: 'EUR' }),
    F('startsOn', 'starts_on'),
    F('endsOn', 'ends_on'),
    F('createdAt', 'created_at'),
    F('updatedAt', 'updated_at'),
];

const GOAL_FIELDS = [
    F('id', 'id'),
    F('userId', 'user_id'),
    F('name', 'name'),
    F('targetAmount', 'target_amount', { num: true }),
    F('currency', 'currency', { default: 'EUR' }),
    F('targetDate', 'target_date'),
    F('accountId', 'account_id'),
    F('startingAmount', 'starting_amount', { num: true, default: 0 }),
    F('color', 'color'),
    F('icon', 'icon'),
    F('isArchived', 'is_archived', { default: false }),
    F('createdAt', 'created_at'),
    F('updatedAt', 'updated_at'),
];

const RULE_FIELDS = [
    F('id', 'id'),
    F('userId', 'user_id'),
    F('merchantKey', 'merchant_key'),
    F('category', 'category'),
    F('displayName', 'display_name'),
    F('source', 'source', { default: 'user' }),
    F('hitCount', 'hit_count', { default: 1 }),
    F('updatedAt', 'updated_at'),
];

// v15 chat history (supabase/migrations/20261111_v15_chat_history.sql). Deletes are soft: deletedAt.
const CHAT_CONVERSATION_FIELDS = [
    F('id', 'id'),
    F('userId', 'user_id'),
    F('title', 'title', { default: null }),
    F('createdAt', 'created_at'),
    F('updatedAt', 'updated_at'),
    F('deletedAt', 'deleted_at', { default: null }),
];

const CHAT_MESSAGE_FIELDS = [
    F('id', 'id'),
    F('userId', 'user_id'),
    F('conversationId', 'conversation_id'),
    F('role', 'role'),
    F('content', 'content', { default: '' }),
    F('meta', 'meta', { default: null }), // jsonb: evidence, action, proposals, state
    F('createdAt', 'created_at'),
    F('updatedAt', 'updated_at'),
    F('deletedAt', 'deleted_at', { default: null }),
];

const isEmpty = (v) => v === undefined || v === null || v === '';

export function makeMapper(fields) {
    return {
        fromRow(row) {
            if (!row) return null;
            const out = {};
            for (const f of fields) {
                let v = row[f.col];
                if (v === undefined) {
                    if (f.optional) continue;
                    v = null;
                }
                if (v === null && f.default !== undefined) v = f.default;
                if (f.num && v !== null && v !== undefined) {
                    const n = parseFloat(v);
                    v = Number.isNaN(n) ? v : n;
                }
                if (f.norm) v = f.norm(v);
                out[f.app] = v;
            }
            return out;
        },
        /**
         * App record -> Supabase row.
         * `partial: true` (updates) only includes keys present on the record so unrelated
         * columns are never overwritten with defaults.
         */
        toRow(rec, { partial = false } = {}) {
            const out = {};
            for (const f of fields) {
                if (f.noWrite) continue;
                let v = rec[f.app];
                if (partial) {
                    if (v === undefined) continue;
                } else if (f.optional) {
                    if (isEmpty(v)) continue;
                } else if (isEmpty(v) && f.default !== undefined) {
                    v = f.default;
                }
                if (f.uuid && v && !isValidUUID(v)) v = null;
                if (f.norm && v !== undefined) v = f.norm(v);
                if (v === undefined) continue;
                out[f.col] = v;
            }
            return out;
        },
    };
}

/** Table registry: Dexie store name -> Supabase table, mapper and key column. */
export const TABLES = {
    transactions: { remote: 'receipts', ...makeMapper(TRANSACTION_FIELDS), key: 'id' },
    groups: { remote: 'groups', ...makeMapper(GROUP_FIELDS), key: 'id' },
    categories: { remote: 'user_categories', ...makeMapper(CATEGORY_FIELDS), key: 'id' },
    settings: { remote: 'settings', ...makeMapper(SETTINGS_FIELDS), key: 'userId', conflict: 'user_id' },
    layouts: { remote: 'user_layouts', ...makeMapper(LAYOUT_FIELDS), key: 'userId', conflict: 'user_id' },
    accounts: { remote: 'accounts', ...makeMapper(ACCOUNT_FIELDS), key: 'id' },
    budgets: { remote: 'budgets', ...makeMapper(BUDGET_FIELDS), key: 'id' },
    goals: { remote: 'savings_goals', ...makeMapper(GOAL_FIELDS), key: 'id' },
    rules: { remote: 'merchant_rules', ...makeMapper(RULE_FIELDS), key: 'id' },
    chatConversations: { remote: 'chat_conversations', ...makeMapper(CHAT_CONVERSATION_FIELDS), key: 'id' },
    chatMessages: { remote: 'chat_messages', ...makeMapper(CHAT_MESSAGE_FIELDS), key: 'id' },
};

// Convenience exports (used by tests and for readability)
export const mappers = Object.fromEntries(Object.entries(TABLES).map(([k, v]) => [k, { fromRow: v.fromRow, toRow: v.toRow }]));

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
function toError(error, status) {
    const err = new Error(error?.message || error?.details || error?.hint || 'Supabase request failed');
    err.code = error?.code;
    err.status = status ?? error?.status;
    err.original = error;
    return err;
}

export function isMissingTableError(err) {
    const msg = String(err?.message || '');
    return (
        err?.code === '42P01' ||
        err?.code === 'PGRST205' ||
        msg.includes('schema cache') ||
        /relation .* does not exist/i.test(msg)
    );
}

/** Errors that mean "try again later" (offline, timeouts, 5xx, rate limits). */
export function isTransientError(err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const status = err?.status;
    if (status && (status >= 500 || status === 408 || status === 429)) return true;
    const msg = String(err?.message || '');
    return /failed to fetch|networkerror|network request failed|load failed|timed out|timeout|fetch failed/i.test(msg) || err?.name === 'TypeError';
}

function client() {
    if (!supabase) throw new Error('Supabase not configured');
    return supabase;
}

export function isConfigured() {
    return supabase !== null;
}

const PAGE = 1000;

// ---------------------------------------------------------------------------
// CRUD. All functions take/return app-format records.
// ---------------------------------------------------------------------------

/** Fetch rows changed since `sinceIso` (inclusive), oldest first. Pages through everything. */
export async function fetchSince(table, userId, sinceIso) {
    const t = TABLES[table];
    const rows = [];
    for (let from = 0; ; from += PAGE) {
        let q = client().from(t.remote).select('*').eq('user_id', userId);
        if (sinceIso) q = q.gte('updated_at', sinceIso);
        const { data, error, status } = await q
            .order('updated_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw toError(error, status);
        rows.push(...data);
        if (data.length < PAGE) break;
    }
    return rows.map((r) => t.fromRow(r));
}

export const PULL_PAGE = 50;

/**
 * One keyset page of rows changed after `after` ({ updatedAt, id }, exclusive; null = from the start), ordered by
 * (updated_at, id). Unlike offset paging, rows inserted or changed while paging are never duplicated or skipped: the next
 * page starts strictly after the last row seen. The cursor keeps the server's own timestamp string (microseconds).
 * -> { rows, next } where `next` is the cursor to continue from, or null when this was the last page.
 */
export async function fetchPage(table, userId, after = null, limit = PULL_PAGE) {
    const t = TABLES[table];
    let q = client().from(t.remote).select('*').eq('user_id', userId);
    if (after?.updatedAt) {
        const u = `"${after.updatedAt}"`;
        q = q.or(`updated_at.gt.${u},and(updated_at.eq.${u},id.gt.${after.id})`);
    }
    const { data, error, status } = await q.order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(limit);
    if (error) throw toError(error, status);
    const rows = (data || []).map((r) => t.fromRow(r));
    const last = rows[rows.length - 1];
    return { rows, next: rows.length >= limit && last ? { updatedAt: last.updatedAt, id: last.id } : null };
}

/** All ids of the user's rows, used to detect rows deleted on another device. */
export async function fetchIds(table, userId) {
    const t = TABLES[table];
    const ids = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error, status } = await client()
            .from(t.remote)
            .select('id')
            .eq('user_id', userId)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw toError(error, status);
        ids.push(...data.map((r) => r.id));
        if (data.length < PAGE) break;
    }
    return ids;
}

/** Server updated_at of one row, or null when the row does not exist. */
export async function fetchUpdatedAt(table, key) {
    const t = TABLES[table];
    const col = t.conflict || 'id';
    const { data, error, status } = await client().from(t.remote).select('updated_at').eq(col, key).maybeSingle();
    if (error) throw toError(error, status);
    return data?.updated_at || null;
}

/** One row by key (app format) or null. */
export async function fetchOne(table, key) {
    const t = TABLES[table];
    const { data, error, status } = await client().from(t.remote).select('*').eq(t.conflict || 'id', key).maybeSingle();
    if (error) throw toError(error, status);
    return data ? t.fromRow(data) : null;
}

/** Insert (idempotent: upsert on primary key so a retried outbox entry never duplicates). */
export async function insert(table, record) {
    const t = TABLES[table];
    const { data, error, status } = await client()
        .from(t.remote)
        .upsert([t.toRow(record)], { onConflict: t.conflict || 'id' })
        .select()
        .maybeSingle();
    if (error) throw toError(error, status);
    return data ? t.fromRow(data) : null;
}

/** Patch an existing row with only the given (app-format) fields. */
export async function update(table, key, patch) {
    const t = TABLES[table];
    const col = t.conflict || 'id';
    const { data, error, status } = await client()
        .from(t.remote)
        .update(t.toRow(patch, { partial: true }))
        .eq(col, key)
        .select()
        .maybeSingle();
    if (error) throw toError(error, status);
    return data ? t.fromRow(data) : null;
}

/** Insert-or-update the complete record (settings, layouts). */
export async function upsert(table, record) {
    return insert(table, record);
}

export async function remove(table, key) {
    const t = TABLES[table];
    const { error, status } = await client().from(t.remote).delete().eq(t.conflict || 'id', key);
    if (error) throw toError(error, status);
}

/**
 * Delete a group on the server. Receipts in the group are first moved to the parent group
 * (nested group) or ungrouped (top-level group) - behaviour carried over from the old service.
 */
export async function removeGroup(groupId) {
    const sb = client();
    const { data: group } = await sb.from('groups').select('parent_group_id').eq('id', groupId).maybeSingle();
    let patch = { group_id: null, group_name: null, group_tags: [] };
    if (group?.parent_group_id) {
        const { data: parent } = await sb.from('groups').select('id, name').eq('id', group.parent_group_id).maybeSingle();
        if (parent) patch = { group_id: parent.id, group_name: parent.name };
    }
    const { error: moveError } = await sb.from('receipts').update(patch).eq('group_id', groupId);
    if (moveError) console.warn('[Data] Failed to reassign receipts of deleted group:', moveError);
    const { error, status } = await sb.from('groups').delete().eq('id', groupId);
    if (error) throw toError(error, status);
}
