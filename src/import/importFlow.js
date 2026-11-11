// CSV import flow (plan P4-T6): parse -> preview items -> apply. Pure except applyImport, which takes the
// data-layer functions as arguments. The wizard UI (components/import/ImportSheet) is a thin shell over this.
import { parseCsv } from './csv';
import { findDuplicates } from './dedupe';
import { parseGeneric } from './parsers/generic';
import { parsePostepay } from './parsers/postepay';
import { parseRevolut } from './parsers/revolut';
import { suggestCategory, toSuggestRules } from '../services/categorizer';
import { displayName, merchantKey } from '../utils/merchant';
import { normalizeCategoryName } from '../utils/categoryNames';
import { tripForDate } from '../utils/tripMath';

export const PROVIDERS = ['revolut', 'postepay', 'other'];
export const FALLBACK = 'Other';

/** Parse the file text with the chosen provider. -> { provider, rows, skipped } (rows as in src/import/parsers). */
export async function parseFor(provider, text, { mapping, currency = 'EUR' } = {}) {
    if (provider === 'revolut') return parseRevolut(text);
    if (provider === 'postepay') return parsePostepay(text, { currency });
    return parseGeneric(text, mapping || {}, { currency });
}

/** Header names of the first row, for the column mapper. */
export function csvHeaders(text) {
    return parseCsv(text).rows[0] || [];
}

/**
 * buildPreview({ rows, existing, trips, rules, names })
 * -> items [{ index, row, category, known, duplicate: null | { existing, reason }, tripId, tripName, action }]
 * action: 'import' | 'merge' | 'skip'.  A row whose importRef is already stored is 'skip' (re-import adds nothing);
 * a row matching a scanned receipt (same amount, +-1 day, no importRef yet) defaults to 'merge'.
 */
export function buildPreview({ rows = [], existing = [], trips = [], rules = [], names = [] }) {
    const pairs = new Map(findDuplicates(rows, existing).map((p) => [p.importedIndex, p]));
    const suggestRules = toSuggestRules(rules);
    return rows.map((row, index) => {
        const pair = pairs.get(index);
        let category = null;
        if (row.transactionType === 'expense') {
            const s = suggestCategory({ merchant: row.description, rules: suggestRules });
            const name = s.category ? normalizeCategoryName(s.category) : null;
            category = name && (names.length === 0 || names.includes(name)) ? name : null;
        }
        const trip = tripForDate(trips, row.date);
        return {
            index,
            row,
            category: category || FALLBACK,
            known: !!category,
            duplicate: pair ? { existing: pair.existing, reason: pair.reason } : null,
            tripId: trip?.id || null,
            tripName: trip?.name || null,
            action: pair ? (pair.reason === 'import_ref' ? 'skip' : 'merge') : 'import',
        };
    });
}

export const summarize = (items) => ({
    import: items.filter((i) => i.action === 'import').length,
    merge: items.filter((i) => i.action === 'merge').length,
    skip: items.filter((i) => i.action === 'skip').length,
    unknown: items.filter((i) => i.action === 'import' && !i.known && i.row.transactionType === 'expense').length,
});

/** The transaction record for an imported row (the caller adds userId). Inbound transfers land in the account. */
export function toTransaction(item, { accountId }) {
    const { row } = item;
    const transfer = row.transactionType === 'transfer';
    const inbound = transfer && row.direction === 'in';
    const merchant = displayName(row.description) || row.description || '';
    return {
        merchant: transfer ? row.description || merchant : merchant,
        merchantKey: transfer ? undefined : merchantKey(row.description) || undefined,
        date: row.date,
        total: row.amount,
        currency: row.currency || 'EUR',
        category: transfer ? 'Transfer' : row.transactionType === 'income' ? 'Income' : item.category,
        transactionType: row.transactionType,
        accountId: inbound ? null : accountId,
        toAccountId: inbound ? accountId : null,
        importRef: row.importRef,
        groupId: item.tripId,
        groupName: item.tripName,
    };
}

/**
 * applyImport({ items, accountId, userId, createTransaction, updateTransaction })
 * Creates the 'import' rows, merges the 'merge' rows into the scanned receipt (receipt keeps items and image, gets the
 * account and the importRef), skips the rest. -> { created, merged, skipped, failed }
 */
export async function applyImport({ items, accountId, userId, createTransaction, updateTransaction }) {
    const out = { created: 0, merged: 0, skipped: 0, failed: 0 };
    for (const item of items) {
        try {
            if (item.action === 'merge' && item.duplicate) {
                await updateTransaction(item.duplicate.existing.id, { accountId, importRef: item.row.importRef });
                out.merged += 1;
            } else if (item.action === 'import') {
                await createTransaction({ ...toTransaction(item, { accountId }), userId });
                out.created += 1;
            } else {
                out.skipped += 1;
            }
        } catch (err) {
            console.warn('[import] row failed', err);
            out.failed += 1;
        }
    }
    return out;
}

// ---- wizard state ------------------------------------------------------------------------------
export const initialState = ({ accountId = null } = {}) => ({
    step: accountId ? 'provider' : 'account',
    accountId,
    provider: null,
    fileName: '',
    text: '',
    mapping: null,
    items: [],
    skipped: [],
    error: null,
    result: null,
});

/** Steps: account -> provider -> file -> (mapping, for 'other') -> preview -> done. */
export function reducer(state, action) {
    switch (action.type) {
        case 'ACCOUNT':
            return { ...state, accountId: action.accountId, step: 'provider', error: null };
        case 'PROVIDER':
            return { ...state, provider: action.provider, step: 'file', text: '', fileName: '', items: [], error: null };
        case 'FILE':
            return { ...state, text: action.text, fileName: action.name, error: null, step: state.provider === 'other' ? 'mapping' : state.step };
        case 'MAPPING':
            return { ...state, mapping: action.mapping };
        case 'PARSED':
            return { ...state, items: action.items, skipped: action.skipped || [], step: 'preview', error: null };
        case 'ERROR':
            return { ...state, error: action.error };
        case 'SET_ACTION':
            return { ...state, items: state.items.map((i) => (i.index === action.index ? { ...i, action: action.action } : i)) };
        case 'DONE':
            return { ...state, result: action.result, step: 'done' };
        case 'BACK': {
            const order = ['account', 'provider', 'file', 'mapping', 'preview'];
            const prev = state.step === 'preview' && state.provider !== 'other' ? 'file' : order[Math.max(0, order.indexOf(state.step) - 1)];
            return { ...state, step: prev, error: null };
        }
        default:
            return state;
    }
}
