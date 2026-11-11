import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronDown, Filter } from 'lucide-react';
import Amount from '../ui/Amount';
import RecordSyncBadge from '../sync/RecordSyncBadge';
import GroupBadge from '../groups/GroupBadge';
import { useTranslation } from '../../languages/useTranslation';
import { displayName } from '../../utils/merchant';
import { ariaSort, isNavKey, moveSelection, SORTABLE, toggleSort } from '../../utils/tableNav';

const ROW_H = 48;
const SECTION_H = 52;
const COLS = 'grid-cols-[84px_minmax(0,1.8fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)_104px]';

/**
 * PC Activity: one row per transaction as a sortable table. Date, Merchant, Category and Amount headers sort; Merchant, Category,
 * Group and Account headers also open their filter (the same filter model as the phone). j/k or the arrow keys move the selection,
 * Enter focuses the detail pane, Esc clears the selection. When the list is grouped (Group / Category / Merchant) the sections show as
 * collapsible header rows between the transactions. Rows are virtualised; semantics are table/row/cell.
 */
export default function ActivityTable({ rows, items = null, selectedId, onSelect, onActivate, onClear, sort, onSort, accountById, groupById = new Map(), syncStates, currency, onHeaderFilter, activeColumns = new Set(), onToggleSection }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const scrollRef = useRef(null);
    const entries = useMemo(() => items || rows.map((tx) => ({ kind: 'tx', tx })), [items, rows]);
    const txRows = useMemo(() => entries.filter((e) => e.kind === 'tx').map((e) => e.tx), [entries]);
    const ordinal = useMemo(() => {
        let n = 0;
        return entries.map((e) => (e.kind === 'tx' ? ++n : 0));
    }, [entries]);
    const rowsRef = useRef(txRows);
    rowsRef.current = txRows;
    const sizeOf = (i) => (entries[i]?.kind === 'section' ? SECTION_H : ROW_H);
    const virtualizer = useVirtualizer({ count: entries.length, getScrollElement: () => scrollRef.current, estimateSize: sizeOf, overscan: 12, initialRect: { width: 800, height: 600 } });
    // Without ResizeObserver (old webviews, jsdom) the scroller cannot be measured: show every row instead of none
    const virtual = useMemo(() => {
        if (typeof ResizeObserver !== 'undefined') return null;
        let start = 0;
        return entries.map((_, index) => {
            const v = { index, start, size: sizeOf(index) };
            start += v.size;
            return v;
        });
    }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps
    const shown = virtual || virtualizer.getVirtualItems();
    const selectedIndex = txRows.findIndex((r) => r.id === selectedId);
    const selectedEntry = entries.findIndex((e) => e.kind === 'tx' && e.tx.id === selectedId);

    // keep the selected row in view when the selection moves
    useEffect(() => {
        if (selectedEntry >= 0) virtualizer.scrollToIndex(selectedEntry, { align: 'auto' });
    }, [selectedEntry]); // eslint-disable-line react-hooks/exhaustive-deps

    // j/k/arrows/Enter/Esc work from anywhere on the page unless the focus is in a field or a dialog
    const keyRef = useRef(null);
    keyRef.current = (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || !isNavKey(e.key)) return;
        const el = e.target;
        const tag = el?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable || el?.closest?.('[role="dialog"], [aria-modal="true"]')) return;
        // inside the detail pane only Esc (close) is ours; the pane itself, the table and the page background take all the keys
        const pane = el?.closest?.('aside[data-testid="detail-pane"]');
        if (pane && el !== pane && e.key !== 'Escape') return;
        if (e.key === 'Enter' && tag === 'BUTTON') return;
        if (e.key === 'Escape') {
            if (selectedId) {
                e.preventDefault();
                onClear();
            }
            return;
        }
        if (e.key === 'Enter') {
            if (selectedId) {
                e.preventDefault();
                onActivate(selectedId);
            }
            return;
        }
        e.preventDefault();
        const next = moveSelection(e.key, selectedIndex, txRows.length);
        if (next >= 0 && rowsRef.current[next]) onSelect(rowsRef.current[next].id);
    };
    useEffect(() => {
        const handler = (e) => keyRef.current?.(e);
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    const date = (d) => new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(`${String(d).slice(0, 10)}T00:00:00`));
    const head = (column, label, { align = '', filter = false } = {}) => {
        const sortable = !!SORTABLE[column];
        const state = ariaSort(sort, column);
        const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown;
        const text = 'text-xs font-semibold uppercase tracking-wide';
        return (
            <div role="columnheader" aria-sort={sortable ? state : undefined} className={`flex min-h-[44px] min-w-0 items-center gap-0.5 ${align}`}>
                {sortable ? (
                    <button type="button" onClick={() => onSort(toggleSort(sort, column))} className={`flex min-h-[44px] min-w-0 items-center gap-1 rounded-lg px-1 ${text} text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink`} data-testid={`sort-${column}`}>
                        <span className="truncate">{label}</span>
                        {state !== 'none' ? <Icon size={13} aria-hidden="true" /> : null}
                    </button>
                ) : (
                    <span className={`truncate px-1 ${text} text-ink-muted`} title={label}>{label}</span>
                )}
                {filter && onHeaderFilter ? (
                    <button
                        type="button"
                        onClick={() => onHeaderFilter(column)}
                        aria-label={t('activity.filterColumn', { column: label })}
                        aria-pressed={activeColumns.has(column)}
                        title={t('activity.filterColumn', { column: label })}
                        className={`flex h-11 w-6 shrink-0 items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink ${activeColumns.has(column) ? 'text-forest-ink' : 'text-ink-faint hover:text-ink'}`}
                        data-testid={`filter-${column}`}
                    >
                        <Filter size={13} fill={activeColumns.has(column) ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>
                ) : null}
            </div>
        );
    };

    return (
        <div role="table" aria-label={t('nav.activity')} aria-rowcount={txRows.length + 1} className="flex min-h-0 flex-1 flex-col" data-testid="activity-table">
            <div role="row" className={`grid ${COLS} items-center gap-2 border-b border-line bg-ground px-4`}>
                {head('date', t('receipts.form.date'))}
                {head('merchant', t('pane.colMerchant'), { filter: true })}
                {head('category', t('pane.colCategory'), { filter: true })}
                {head('group', t('activity.group'), { filter: true })}
                {head('account', t('pane.colAccount'), { filter: true })}
                {head('amount', t('pane.colAmount'), { align: 'justify-end' })}
            </div>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2" tabIndex={-1}>
                <div role="rowgroup" style={{ height: virtual ? shown.reduce((a, v) => a + v.size, 0) : virtualizer.getTotalSize() }} className="relative">
                    {shown.map((v) => {
                        const entry = entries[v.index];
                        if (!entry) return null;
                        if (entry.kind === 'section' || entry.kind === 'day') {
                            const s = entry;
                            const color = s.by === 'group' ? groupById.get(s.key)?.color : null;
                            return (
                                <div key={`s-${s.key}`} role="row" className="absolute inset-x-0 top-0 flex items-end border-b border-line px-2 pb-1" style={{ height: v.size, transform: `translateY(${v.start}px)` }} data-testid="table-section">
                                    <span role="cell" className="flex w-full">
                                        <button type="button" onClick={() => onToggleSection?.(s.key)} aria-expanded={!s.collapsed} className="flex min-h-[44px] w-full items-center gap-2 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink">
                                            <ChevronDown size={15} className={`text-ink-muted transition-transform duration-inline ease-out ${s.collapsed ? '-rotate-90 rtl:rotate-90' : ''}`} aria-hidden="true" />
                                            {color ? <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" /> : null}
                                            <span className="truncate text-[13px] font-semibold uppercase tracking-wider text-ink">{s.label}</span>
                                            <span className="text-xs text-ink-muted">{s.count}</span>
                                            <span className="lead text-ink-muted" aria-hidden="true" />
                                            {s.income > 0 ? <Amount value={s.income} currency={currency} sign tone="income" className="text-[13px]" /> : null}
                                            {s.expense > 0 ? <Amount value={-s.expense} currency={currency} className="text-[13px] text-ink" /> : null}
                                        </button>
                                    </span>
                                </div>
                            );
                        }
                        const tx = entry.tx;
                        const selected = tx.id === selectedId;
                        const type = tx.transactionType || 'expense';
                        const group = tx.groupId ? groupById.get(tx.groupId) || (tx.groupName ? { name: tx.groupName } : null) : null;
                        const isFirst = txRows[0]?.id === tx.id;
                        return (
                            <div
                                key={tx.id}
                                role="row"
                                aria-rowindex={ordinal[v.index] + 1}
                                aria-selected={selected}
                                tabIndex={selected || (selectedIndex < 0 && isFirst) ? 0 : -1}
                                onClick={() => onSelect(tx.id)}
                                onDoubleClick={() => onActivate(tx.id)}
                                data-testid="activity-row"
                                data-selected={selected ? 'true' : undefined}
                                className={`absolute inset-x-0 top-0 grid ${COLS} cursor-pointer items-center gap-2 rounded-xl px-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-forest-ink ${selected ? 'bg-mint' : 'hover:bg-tint'}`}
                                style={{ height: v.size, transform: `translateY(${v.start}px)` }}
                            >
                                <span role="cell" className="truncate text-ink-muted">{date(tx.date)}</span>
                                <span role="cell" className="flex min-w-0 items-center gap-2 text-ink">
                                    <span className="truncate font-medium">{tx.merchant || displayName(tx.merchant) || t('dashboard.topMerchants.unknown')}</span>
                                    {syncStates?.get(tx.id)?.overall ? <RecordSyncBadge state={syncStates.get(tx.id).overall} compact /> : null}
                                </span>
                                <span role="cell" className="truncate text-ink-muted">{type === 'income' ? t('quickAdd.income') : type === 'transfer' ? t('activity.transferLabel') : localizeCategory(tx.category || 'Other')}</span>
                                <span role="cell" className="flex min-w-0 text-ink-muted">{group ? <GroupBadge group={group} className="max-w-full" /> : null}</span>
                                <span role="cell" className="truncate text-ink-muted">{accountById.get(tx.accountId) || ''}</span>
                                <span role="cell" className="flex justify-end">
                                    <Amount value={type === 'income' ? tx.total : -Math.abs(tx.total)} currency={tx.currency || currency} symbol={!!tx.currency && tx.currency !== currency} sign={type === 'income'} tone={type === 'income' ? 'income' : 'default'} className="text-[14px]" />
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
