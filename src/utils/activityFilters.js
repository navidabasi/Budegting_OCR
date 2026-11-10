/**
 * Activity filters: URL <-> filter object, matching, amount search, day grouping and month totals.
 *
 * URL params: m=YYYY-MM|all, type=expense|income|transfer, cat=A,B (multi), acct=<id>, tracking=tracked|open|done,
 * uncat=1, merchant=<name>, q=<text>, sort=date|amount, dir=asc|desc.
 * Legacy dashboard links keep working: month+year (1-based month), category (+filter=category), merchant, type, tracking.
 */
import { normalizeCategoryName } from './categoryNames';
import { getTrackingStatus, shouldIncludeInSpendingTotals } from './tracking';

export const DEFAULT_FILTERS = Object.freeze({ month: null, type: '', categories: [], accountId: '', tracking: '', uncategorised: false, merchant: '', q: '', sort: 'date', dir: 'desc' });

const pad = (n) => String(n).padStart(2, '0');
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const SORTS = ['date', 'amount'];

export function parseFilters(params, now = new Date()) {
    const get = (k) => params.get(k) || '';
    const legacyMonth = get('month');
    const legacyYear = get('year');
    const categories = (get('cat') ? get('cat').split(',') : []).map((c) => normalizeCategoryName(c.trim())).filter(Boolean);
    const legacyCategory = get('category');
    if (legacyCategory && !categories.length) categories.push(normalizeCategoryName(decodeURIComponent(legacyCategory)));

    let month = get('m');
    if (!month && /^\d{1,2}$/.test(legacyMonth) && /^\d{4}$/.test(legacyYear)) month = `${legacyYear}-${pad(Number(legacyMonth))}`;
    const hasOtherFilter = !!(get('type') || categories.length || get('merchant') || get('tracking') || get('acct') || get('uncat') || get('q'));
    if (!month) month = hasOtherFilter || legacyYear ? 'all' : monthKey(now); // old links without a month meant "all time"
    if (month !== 'all' && !/^\d{4}-\d{2}$/.test(month)) month = monthKey(now);

    const type = ['expense', 'income', 'transfer'].includes(get('type')) ? get('type') : '';
    const tracking = ['tracked', 'open', 'done'].includes(get('tracking')) ? get('tracking') : '';
    return {
        month,
        type,
        categories,
        accountId: get('acct'),
        tracking,
        uncategorised: get('uncat') === '1',
        merchant: get('merchant') ? decodeURIComponent(get('merchant')) : '',
        q: get('q'),
        sort: SORTS.includes(get('sort')) ? get('sort') : 'date',
        dir: get('dir') === 'asc' ? 'asc' : 'desc',
    };
}

/** Filters -> URLSearchParams, omitting defaults (the current month is the default month). */
export function serializeFilters(f, now = new Date()) {
    const p = new URLSearchParams();
    if (f.month !== monthKey(now)) p.set('m', f.month);
    if (f.type) p.set('type', f.type);
    if (f.categories.length) p.set('cat', f.categories.join(','));
    if (f.accountId) p.set('acct', f.accountId);
    if (f.tracking) p.set('tracking', f.tracking);
    if (f.uncategorised) p.set('uncat', '1');
    if (f.merchant) p.set('merchant', f.merchant);
    if (f.q) p.set('q', f.q);
    if (f.sort !== 'date') p.set('sort', f.sort);
    if (f.dir !== 'desc') p.set('dir', f.dir);
    return p;
}

const norm = (s) => String(s || '').toLowerCase();

/** "12.4", "12,40", "1.240,30", "€ 12" -> the text to compare against "12.40"-style amounts; null when not numeric. */
export function amountQuery(q) {
    let s = String(q || '').trim().replace(/[€$£\s]/g, '');
    if (!/^\d[\d.,]*$/.test(s)) return null;
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    return /^\d+\.?\d*$/.test(s) ? s : null;
}

export const amountMatches = (total, q) => {
    const s = amountQuery(q);
    if (s === null) return false;
    const n = Number(total);
    if (!Number.isFinite(n)) return false;
    return Math.abs(n).toFixed(2).startsWith(s);
};

export function matchesSearch(tx, q) {
    const text = norm(q).trim();
    if (!text) return true;
    return norm(tx.merchant).includes(text) || norm(tx.notes).includes(text) || amountMatches(tx.total, q);
}

export const isUncategorised = (tx) => (tx.transactionType || 'expense') === 'expense' && (!tx.category || tx.category === 'Other');
export const isUnpaid = (tx) => getTrackingStatus(tx) === 'open';

/** Apply every filter except the month when `ignoreMonth` (used for the chip counts). */
export function applyFilters(transactions, f, { ignoreMonth = false } = {}) {
    const out = transactions.filter((tx) => {
        if (!ignoreMonth && f.month !== 'all' && String(tx.date || '').slice(0, 7) !== f.month) return false;
        if (f.type && (tx.transactionType || 'expense') !== f.type) return false;
        if (f.categories.length && !f.categories.includes(tx.category)) return false;
        if (f.accountId && tx.accountId !== f.accountId && tx.toAccountId !== f.accountId) return false;
        if (f.merchant && tx.merchant !== f.merchant) return false;
        if (f.tracking) {
            const status = getTrackingStatus(tx);
            if (f.tracking === 'tracked' ? !status : status !== f.tracking) return false;
        }
        if (f.uncategorised && !isUncategorised(tx)) return false;
        return matchesSearch(tx, f.q);
    });
    const dir = f.dir === 'asc' ? 1 : -1;
    return out.sort((a, b) => {
        if (f.sort === 'amount') return (Number(a.total) - Number(b.total)) * dir || String(b.date).localeCompare(String(a.date));
        return String(a.date).localeCompare(String(b.date)) * dir || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) * dir;
    });
}

const base = (tx) => (Number.isFinite(Number(tx.amountBase)) && tx.amountBase !== null ? Number(tx.amountBase) : Number(tx.total) || 0);

/** { count, income, expense } for the month strip; planned/unpaid and transfers are not money moved. */
export function summarize(list) {
    let income = 0;
    let expense = 0;
    for (const tx of list) {
        if (!shouldIncludeInSpendingTotals(tx)) continue;
        if ((tx.transactionType || 'expense') === 'income') income += base(tx);
        else expense += base(tx);
    }
    const r = (n) => Math.round(n * 100) / 100;
    return { count: list.length, income: r(income), expense: r(expense) };
}

/** Flat list for a virtual list: [{ kind: 'day', key, total, count }, { kind: 'tx', tx }, ...] in the order given. */
export function groupByDay(list) {
    const items = [];
    let current = null;
    for (const tx of list) {
        const key = String(tx.date || '').slice(0, 10);
        if (!current || current.key !== key) {
            current = { kind: 'day', key, total: 0, count: 0 };
            items.push(current);
        }
        current.count += 1;
        if ((tx.transactionType || 'expense') === 'expense' && shouldIncludeInSpendingTotals(tx)) current.total += base(tx);
        items.push({ kind: 'tx', tx });
    }
    items.filter((i) => i.kind === 'day').forEach((d) => (d.total = Math.round(d.total * 100) / 100));
    return items;
}

export const activeFilterCount = (f) => (f.type ? 1 : 0) + (f.categories.length ? 1 : 0) + (f.accountId ? 1 : 0) + (f.tracking ? 1 : 0) + (f.uncategorised ? 1 : 0) + (f.merchant ? 1 : 0) + (f.q ? 1 : 0);
