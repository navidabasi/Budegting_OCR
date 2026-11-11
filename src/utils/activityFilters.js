/**
 * Activity filters: URL <-> filter object, matching, search syntax, grouping (day / group / category / merchant), totals and the
 * descriptors behind the removable filter chips. Pure.
 *
 * URL params (all optional, defaults are omitted):
 *   m=YYYY-MM|c:YYYY-MM|r:A..B|all  type=expense|income|transfer  cat=A,B  acct=<id>,<id>  group=<id>,<id>  trip=<id>
 *   merchant=<name> (repeatable)  tag=<tag> (repeatable)  min=<n>  max=<n>  photo=1  shared=1  review=1
 *   tracking=tracked|open|done  uncat=1  q=<text>  sort=date|amount|merchant|category  dir=asc|desc
 * Legacy dashboard links keep working: month+year (1-based month), category (+filter=category), merchant, type, tracking, and the
 * single-valued acct= / group= (a group= that names a trip still matches that trip's transactions).
 */
import { normalizeCategoryName } from './categoryNames';
import { merchantKey } from './merchant';
import { inPeriod } from './period';
import { fullAmount, shareAmount } from './money';
import { getTrackingStatus, shouldIncludeInSpendingTotals } from './tracking';
import { readSplit } from './splits';

export const DEFAULT_FILTERS = Object.freeze({
    month: null,
    type: '',
    categories: [],
    accountIds: [],
    accountId: '',
    groupIds: [],
    groupId: '',
    tripId: '',
    merchants: [],
    merchant: '',
    tags: [],
    amountMin: '',
    amountMax: '',
    hasPhoto: false,
    shared: false,
    needsReview: false,
    tracking: '',
    uncategorised: false,
    q: '',
    sort: 'date',
    dir: 'desc',
});

const pad = (n) => String(n).padStart(2, '0');
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const SORTS = ['date', 'amount', 'merchant', 'category'];
export const GROUP_BYS = ['day', 'group', 'category', 'merchant'];

const SPEC = /^(\d{4}-\d{2}|c:\d{4}-\d{2}|r:\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})$/;
const list = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []);
const uniq = (arr) => [...new Set(arr)];

/** "12,40" / "12.4" / "1.240,30" -> 12.4; '' / garbage -> '' (amount fields stay strings so the inputs keep what was typed). */
export function parseAmount(v) {
    let s = String(v ?? '').trim().replace(/[€$£\s]/g, '');
    if (!s) return '';
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : '';
}

/**
 * `defaultSpec`: the current period (pay cycle spec) when the URL has no m; defaults to the calendar month.
 * `defaultSort`: the sort remembered on this device ({ sort, dir }) used when the URL names none.
 */
export function parseFilters(params, now = new Date(), { defaultSpec, defaultSort } = {}) {
    const get = (k) => params.get(k) || '';
    const all = (k) => (typeof params.getAll === 'function' ? params.getAll(k) : [get(k)]).filter(Boolean);
    const legacyMonth = get('month');
    const legacyYear = get('year');
    const categories = list(get('cat')).map((c) => normalizeCategoryName(c)).filter(Boolean);
    const legacyCategory = get('category');
    if (legacyCategory && !categories.length) categories.push(normalizeCategoryName(decodeURIComponent(legacyCategory)));

    let month = get('m');
    if (!month && /^\d{1,2}$/.test(legacyMonth) && /^\d{4}$/.test(legacyYear)) month = `${legacyYear}-${pad(Number(legacyMonth))}`;
    const OTHER = ['type', 'merchant', 'tracking', 'acct', 'group', 'trip', 'uncat', 'q', 'tag', 'min', 'max', 'photo', 'shared', 'review'];
    const hasOtherFilter = !!(categories.length || OTHER.some((k) => get(k)));
    const fallback = defaultSpec || monthKey(now);
    if (!month) month = hasOtherFilter || legacyYear ? 'all' : fallback; // old links without a month meant "all time"
    if (month !== 'all' && !SPEC.test(month)) month = fallback;

    const type = ['expense', 'income', 'transfer'].includes(get('type')) ? get('type') : '';
    const tracking = ['tracked', 'open', 'done'].includes(get('tracking')) ? get('tracking') : '';
    const accountIds = uniq(list(get('acct')));
    const groupIds = uniq(list(get('group')));
    const merchants = uniq(all('merchant').map((m) => decodeURIComponent(m)));
    const sortDefault = defaultSort && SORTS.includes(defaultSort.sort) ? defaultSort : { sort: 'date', dir: 'desc' };
    const sort = SORTS.includes(get('sort')) ? get('sort') : sortDefault.sort;
    const dir = get('dir') === 'asc' || get('dir') === 'desc' ? get('dir') : get('sort') ? 'desc' : sortDefault.dir;
    return {
        month,
        type,
        categories,
        accountIds,
        accountId: accountIds[0] || '',
        groupIds,
        groupId: groupIds[0] || '',
        tripId: get('trip'),
        merchants,
        merchant: merchants[0] || '',
        tags: uniq(all('tag')),
        amountMin: parseAmount(get('min')),
        amountMax: parseAmount(get('max')),
        hasPhoto: get('photo') === '1',
        shared: get('shared') === '1',
        needsReview: get('review') === '1',
        tracking,
        uncategorised: get('uncat') === '1',
        q: get('q'),
        sort,
        dir,
    };
}

/**
 * Patch helper: the single-valued legacy fields (accountId, groupId, merchant) and their arrays always agree. A patch that sets the
 * array wins; a patch that only sets the legacy field replaces the array with it.
 */
export function mergeFilters(f, patch = {}) {
    const next = { ...DEFAULT_FILTERS, ...f, ...patch };
    const sync = (arrKey, oneKey) => {
        if (patch[arrKey] === undefined && patch[oneKey] !== undefined) next[arrKey] = patch[oneKey] ? [patch[oneKey]] : [];
        next[arrKey] = uniq(next[arrKey] || []);
        next[oneKey] = next[arrKey][0] || '';
    };
    sync('accountIds', 'accountId');
    sync('groupIds', 'groupId');
    sync('merchants', 'merchant');
    return next;
}

/** Filters -> URLSearchParams, omitting defaults (the current period is the default period). */
export function serializeFilters(f0, now = new Date(), { defaultSpec, defaultSort } = {}) {
    const f = mergeFilters(f0);
    const p = new URLSearchParams();
    if (f.month !== (defaultSpec || monthKey(now))) p.set('m', f.month);
    if (f.type) p.set('type', f.type);
    if (f.categories.length) p.set('cat', f.categories.join(','));
    if (f.accountIds.length) p.set('acct', f.accountIds.join(','));
    if (f.groupIds.length) p.set('group', f.groupIds.join(','));
    if (f.tripId) p.set('trip', f.tripId);
    if (f.tracking) p.set('tracking', f.tracking);
    if (f.uncategorised) p.set('uncat', '1');
    f.merchants.forEach((m) => p.append('merchant', m));
    f.tags.forEach((tag) => p.append('tag', tag));
    if (f.amountMin !== '' && f.amountMin !== null && f.amountMin !== undefined) p.set('min', String(f.amountMin));
    if (f.amountMax !== '' && f.amountMax !== null && f.amountMax !== undefined) p.set('max', String(f.amountMax));
    if (f.hasPhoto) p.set('photo', '1');
    if (f.shared) p.set('shared', '1');
    if (f.needsReview) p.set('review', '1');
    if (f.q) p.set('q', f.q);
    const ds = defaultSort && SORTS.includes(defaultSort.sort) ? defaultSort : { sort: 'date', dir: 'desc' };
    if (f.sort !== ds.sort || f.dir !== ds.dir) {
        p.set('sort', f.sort);
        p.set('dir', f.dir);
    }
    return p;
}

const norm = (s) =>
    String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

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

/**
 * One search token: `>50`, `>=50`, `<20`, `<=20`, `10-20` (amount comparisons) or `12,40` / `12.4` (amount prefix) or text.
 * Returns { kind: 'cmp', test(n) } | { kind: 'num', text } | { kind: 'text', text }.
 */
export function parseSearchToken(token) {
    const s = String(token || '').trim();
    const cmp = s.match(/^(>=|<=|>|<)\s*(\d[\d.,]*)$/);
    if (cmp) {
        const v = parseAmount(cmp[2]);
        if (v !== '') {
            const op = cmp[1];
            return { kind: 'cmp', test: (n) => (op === '>' ? n > v : op === '<' ? n < v : op === '>=' ? n >= v : n <= v) };
        }
    }
    const range = s.match(/^(\d[\d.,]*)\s*-\s*(\d[\d.,]*)$/);
    if (range) {
        const a = parseAmount(range[1]);
        const b = parseAmount(range[2]);
        if (a !== '' && b !== '') {
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            return { kind: 'cmp', test: (n) => n >= lo && n <= hi };
        }
    }
    if (amountQuery(s) !== null) return { kind: 'num', text: s };
    return { kind: 'text', text: norm(s) };
}

/** Text the search looks in: merchant, notes, item names, category (and its label), group, tags. */
function haystack(tx, ctx = {}) {
    const items = Array.isArray(tx.lineItems) ? tx.lineItems.map((it) => it?.name || it?.description || it?.rawText || '').join(' ') : '';
    const cat = tx.category ? `${tx.category} ${ctx.localizeCategory ? ctx.localizeCategory(tx.category) : ''}` : '';
    const group = tx.groupId && ctx.groupById?.get(tx.groupId)?.name ? ctx.groupById.get(tx.groupId).name : tx.groupName || '';
    const tags = Array.isArray(tx.groupTags) ? tx.groupTags.join(' ') : '';
    return norm([tx.merchant, tx.notes, items, cat, group, tags].join(' \u0001 '));
}

/**
 * Search: every whitespace-separated token must match. Text tokens look in merchant, notes, item names, category, group and tags;
 * number tokens match an amount prefix ("12,40") or text; `>50`, `<20`, `10-20` compare the amount. A query that is one amount
 * ("1.240,30", "€ 12") is read as a whole first so thousands separators survive.
 */
export function matchesSearch(tx, q, ctx = {}) {
    const raw = String(q || '').trim();
    if (!raw) return true;
    const amount = Math.abs(Number(tx.total));
    const hay = haystack(tx, ctx);
    if (amountQuery(raw) !== null) return amountMatches(tx.total, raw) || hay.includes(norm(raw));
    return raw.split(/\s+/).every((token) => {
        const p = parseSearchToken(token);
        if (p.kind === 'cmp') return Number.isFinite(amount) && p.test(amount);
        if (p.kind === 'num') return amountMatches(tx.total, p.text) || hay.includes(norm(p.text));
        return hay.includes(p.text);
    });
}

export const isUncategorised = (tx) => (tx.transactionType || 'expense') === 'expense' && (!tx.category || tx.category === 'Other');
export const isUnpaid = (tx) => getTrackingStatus(tx) === 'open';
export const hasPhoto = (tx) => !!tx.imagePath;
export const isShared = (tx) => !!readSplit(tx.splitData, tx.total);
/** Waiting to be read, read but not yet reviewed, or with item lines flagged as uncertain. */
export const needsReview = (tx) =>
    !!(tx.extraction?.pending || tx.extraction?.needsReview || (Array.isArray(tx.lineItems) && tx.lineItems.some((it) => it?.reviewStatus === 'needs_review')));

const txMerchantMatches = (tx, m) => tx.merchant === m || (tx.merchantKey || merchantKey(tx.merchant)) === m; // insights link by merchant key

/** Does one transaction pass every filter except the period? */
export function matchesFilters(tx, f, ctx = {}) {
    if (f.type && (tx.transactionType || 'expense') !== f.type) return false;
    if (f.categories?.length && !f.categories.includes(tx.category)) return false;
    const accountIds = f.accountIds?.length ? f.accountIds : f.accountId ? [f.accountId] : [];
    if (accountIds.length && !accountIds.includes(tx.accountId) && !accountIds.includes(tx.toAccountId)) return false;
    const groupIds = f.groupIds?.length ? f.groupIds : f.groupId ? [f.groupId] : [];
    if (groupIds.length && !groupIds.includes(tx.groupId)) return false;
    if (f.tripId && tx.groupId !== f.tripId) return false;
    const merchants = f.merchants?.length ? f.merchants : f.merchant ? [f.merchant] : [];
    if (merchants.length && !merchants.some((m) => txMerchantMatches(tx, m))) return false;
    if (f.tags?.length && !f.tags.some((tag) => (tx.groupTags || []).includes(tag))) return false;
    const amount = Math.abs(Number(tx.total) || 0);
    if (f.amountMin !== '' && f.amountMin !== undefined && f.amountMin !== null && amount < Number(f.amountMin)) return false;
    if (f.amountMax !== '' && f.amountMax !== undefined && f.amountMax !== null && amount > Number(f.amountMax)) return false;
    if (f.hasPhoto && !hasPhoto(tx)) return false;
    if (f.shared && !isShared(tx)) return false;
    if (f.needsReview && !needsReview(tx)) return false;
    if (f.tracking) {
        const status = getTrackingStatus(tx);
        if (f.tracking === 'tracked' ? !status : status !== f.tracking) return false;
    }
    if (f.uncategorised && !isUncategorised(tx)) return false;
    return matchesSearch(tx, f.q, ctx);
}

const byText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });

/** Sort in place by the filter's sort and direction; ties fall back to the newest first. */
export function sortTransactions(rows, f) {
    const dir = f.dir === 'asc' ? 1 : -1;
    const newest = (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    return rows.sort((a, b) => {
        if (f.sort === 'amount') return (Number(a.total) - Number(b.total)) * dir || newest(a, b);
        if (f.sort === 'merchant') return byText(a.merchant, b.merchant) * dir || newest(a, b);
        if (f.sort === 'category') return byText(a.category, b.category) * dir || newest(a, b);
        return String(a.date).localeCompare(String(b.date)) * dir || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) * dir;
    });
}

/** Apply every filter (the period too unless `ignoreMonth`). ctx: { period, localizeCategory, groupById } for search. */
export function applyFilters(transactions, f, { ignoreMonth = false, period = null, ...ctx } = {}) {
    const out = transactions.filter((tx) => {
        if (!ignoreMonth && f.month !== 'all' && (period ? !inPeriod(tx.date, period) : String(tx.date || '').slice(0, 7) !== f.month)) return false;
        return matchesFilters(tx, f, ctx);
    });
    return sortTransactions(out, f);
}

/** { count, income, expense } for the month strip; planned/unpaid and transfers are not money moved. */
export function summarize(list) {
    let income = 0;
    let expense = 0;
    let expenseShare = 0;
    for (const tx of list) {
        if (!shouldIncludeInSpendingTotals(tx)) continue;
        if ((tx.transactionType || 'expense') === 'income') income += fullAmount(tx); // 0 for a foreign record without a rate: never 1:1
        else {
            expense += fullAmount(tx);
            expenseShare += shareAmount(tx);
        }
    }
    const r = (n) => Math.round(n * 100) / 100;
    // `expense` is the full amount paid (cash movement); `expenseShare` is the part that is yours when expenses were split
    return { count: list.length, income: r(income), expense: r(expense), expenseShare: r(expenseShare) };
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
        if ((tx.transactionType || 'expense') === 'expense' && shouldIncludeInSpendingTotals(tx)) current.total += fullAmount(tx);
        items.push({ kind: 'tx', tx });
    }
    items.filter((i) => i.kind === 'day').forEach((d) => (d.total = Math.round(d.total * 100) / 100));
    return items;
}

export const NO_GROUP = '__none__';

/** The section a transaction falls into for a group-by mode. */
export function sectionKeyOf(tx, by) {
    if (by === 'group') return tx.groupId || NO_GROUP;
    if (by === 'category') {
        const type = tx.transactionType || 'expense';
        return type === 'expense' ? tx.category || 'Other' : type === 'income' ? 'Income' : 'Transfer';
    }
    if (by === 'merchant') return tx.merchantKey || merchantKey(tx.merchant) || NO_GROUP;
    return String(tx.date || '').slice(0, 10);
}

/**
 * Sections for Group / Category / Merchant: [{ kind: 'section', by, key, label, count, expense, income, collapsed }, { kind: 'tx', tx }, ...].
 * Sections are ordered by money out (largest first), then money in; "No group" goes last. Inside a section the order of `list`
 * (the chosen sort) is kept. Collapsed sections keep their header and drop their rows. `by === 'day'` is groupByDay.
 */
export function groupItems(list, by = 'day', { collapsed = new Set(), labelOf } = {}) {
    if (!GROUP_BYS.includes(by) || by === 'day') return groupByDay(list);
    const sections = new Map();
    for (const tx of list) {
        const key = sectionKeyOf(tx, by);
        let s = sections.get(key);
        if (!s) {
            s = { kind: 'section', by, key, label: labelOf ? labelOf(key, tx) : by === 'merchant' ? tx.merchant || '' : key, count: 0, expense: 0, income: 0, rows: [] };
            sections.set(key, s);
        }
        s.count += 1;
        s.rows.push(tx);
        if (!shouldIncludeInSpendingTotals(tx)) continue;
        const type = tx.transactionType || 'expense';
        if (type === 'expense') s.expense += fullAmount(tx);
        else if (type === 'income') s.income += fullAmount(tx);
    }
    const ordered = [...sections.values()].sort((a, b) => (a.key === NO_GROUP) - (b.key === NO_GROUP) || b.expense - a.expense || b.income - a.income || b.count - a.count || byText(a.label, b.label));
    const items = [];
    for (const s of ordered) {
        const { rows, ...head } = s;
        head.expense = Math.round(head.expense * 100) / 100;
        head.income = Math.round(head.income * 100) / 100;
        head.collapsed = collapsed.has(s.key);
        items.push(head);
        if (!head.collapsed) rows.forEach((tx) => items.push({ kind: 'tx', tx }));
    }
    return items;
}

/**
 * The active filters as removable descriptors: [{ id, kind, value, patch }]. `patch` removes that one filter. The period and the
 * sort are not filters here (they always have a value). Order: type, categories, groups, trip, accounts, merchants, tags, amount,
 * status flags, search.
 */
export function describeFilters(f0) {
    const f = mergeFilters(f0);
    const out = [];
    const without = (key, v) => ({ [key]: f[key].filter((x) => x !== v) });
    if (f.type) out.push({ id: 'type', kind: 'type', value: f.type, patch: { type: '' } });
    f.categories.forEach((c) => out.push({ id: `cat:${c}`, kind: 'category', value: c, patch: without('categories', c) }));
    f.groupIds.forEach((g) => out.push({ id: `group:${g}`, kind: 'group', value: g, patch: without('groupIds', g) }));
    if (f.tripId) out.push({ id: 'trip', kind: 'trip', value: f.tripId, patch: { tripId: '' } });
    f.accountIds.forEach((a) => out.push({ id: `acct:${a}`, kind: 'account', value: a, patch: without('accountIds', a) }));
    f.merchants.forEach((m) => out.push({ id: `merchant:${m}`, kind: 'merchant', value: m, patch: without('merchants', m) }));
    f.tags.forEach((tag) => out.push({ id: `tag:${tag}`, kind: 'tag', value: tag, patch: without('tags', tag) }));
    const hasMin = f.amountMin !== '' && f.amountMin !== null && f.amountMin !== undefined;
    const hasMax = f.amountMax !== '' && f.amountMax !== null && f.amountMax !== undefined;
    if (hasMin || hasMax) out.push({ id: 'amount', kind: 'amount', value: { min: hasMin ? Number(f.amountMin) : null, max: hasMax ? Number(f.amountMax) : null }, patch: { amountMin: '', amountMax: '' } });
    if (f.tracking) out.push({ id: 'tracking', kind: 'tracking', value: f.tracking, patch: { tracking: '' } });
    if (f.needsReview) out.push({ id: 'review', kind: 'needsReview', value: true, patch: { needsReview: false } });
    if (f.uncategorised) out.push({ id: 'uncat', kind: 'uncategorised', value: true, patch: { uncategorised: false } });
    if (f.shared) out.push({ id: 'shared', kind: 'shared', value: true, patch: { shared: false } });
    if (f.hasPhoto) out.push({ id: 'photo', kind: 'hasPhoto', value: true, patch: { hasPhoto: false } });
    if (f.q) out.push({ id: 'q', kind: 'search', value: f.q, patch: { q: '' } });
    return out;
}

export const activeFilterCount = (f) => describeFilters(f).length;

/** Every filter removed (period and sort kept). */
export const clearedFilters = (f) => ({ ...mergeFilters(DEFAULT_FILTERS), month: f.month, sort: f.sort, dir: f.dir });

/**
 * Why a filtered list is empty: the one active filter whose removal brings back the most transactions, as { descriptor, count },
 * or { descriptor: null, count } when only the period is left (count = results with the period set to all time).
 */
export function emptyReason(transactions, f, opts = {}) {
    let best = null;
    for (const d of describeFilters(f)) {
        const count = applyFilters(transactions, mergeFilters(f, d.patch), opts).length;
        if (count > 0 && (!best || count > best.count)) best = { descriptor: d, count };
    }
    if (best) return best;
    if (f.month !== 'all') {
        const count = applyFilters(transactions, { ...f, month: 'all' }, opts).length;
        if (count > 0) return { descriptor: { id: 'period', kind: 'period', value: f.month, patch: { month: 'all' } }, count };
    }
    return null;
}

/** Counts and spending per option for a picker: Map(value -> { count, total }) over `rows` with `keyOf(tx)` (string or array). */
export function optionStats(rows, keyOf) {
    const out = new Map();
    for (const tx of rows) {
        const keys = [].concat(keyOf(tx) || []);
        for (const k of keys) {
            if (!k) continue;
            const s = out.get(k) || { count: 0, total: 0 };
            s.count += 1;
            if ((tx.transactionType || 'expense') !== 'transfer' && shouldIncludeInSpendingTotals(tx)) s.total = Math.round((s.total + fullAmount(tx)) * 100) / 100;
            out.set(k, s);
        }
    }
    return out;
}

/** Merchants in `rows` for the merchant filter: [{ value: merchant key, label (most used spelling), count, total }], most used first. */
export function merchantOptions(rows) {
    const map = new Map();
    for (const tx of rows) {
        const key = tx.merchantKey || merchantKey(tx.merchant);
        if (!key || (tx.transactionType || 'expense') === 'transfer') continue;
        const m = map.get(key) || { value: key, count: 0, total: 0, spellings: new Map() };
        m.count += 1;
        if (shouldIncludeInSpendingTotals(tx)) m.total = Math.round((m.total + fullAmount(tx)) * 100) / 100;
        m.spellings.set(tx.merchant, (m.spellings.get(tx.merchant) || 0) + 1);
        map.set(key, m);
    }
    return [...map.values()]
        .map(({ spellings, ...m }) => ({ ...m, label: [...spellings.entries()].sort((a, b) => b[1] - a[1])[0][0] || m.value }))
        .sort((a, b) => b.count - a.count || b.total - a.total);
}

/** Tags used in `rows`, most used first. */
export function tagOptions(rows) {
    const counts = new Map();
    for (const tx of rows) for (const tag of tx.groupTags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: `#${value}`, count }));
}

/** Quick amount ranges for the filter sheet. */
export const AMOUNT_RANGES = [
    { id: 'lt10', min: '', max: 10 },
    { id: '10to50', min: 10, max: 50 },
    { id: '50to100', min: 50, max: 100 },
    { id: 'gt100', min: 100, max: '' },
];
