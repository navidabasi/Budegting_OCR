import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp } from 'lucide-react';
import Amount from '../ui/Amount';
import RecordSyncBadge from '../sync/RecordSyncBadge';
import { useTranslation } from '../../languages/useTranslation';
import { displayName } from '../../utils/merchant';
import { ariaSort, isNavKey, moveSelection, toggleSort } from '../../utils/tableNav';

const ROW_H = 48;
const COLS = 'grid-cols-[96px_minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_120px]';

/**
 * PC Activity: one row per transaction (no day groups) as a sortable table. Date and Amount headers sort; j/k or the arrow keys move the
 * selection, Enter focuses the detail pane, Esc clears the selection. The selected row's detail shows beside the table.
 * The rows are virtualised inside their own scroller; semantics are table/row/cell so assistive tech reads it as a table.
 */
export default function ActivityTable({ rows, selectedId, onSelect, onActivate, onClear, sort, onSort, accountById, syncStates, currency }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const scrollRef = useRef(null);
    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 12, initialRect: { width: 800, height: 600 } });
    // Without ResizeObserver (old webviews, jsdom) the scroller cannot be measured: show every row instead of none
    const items = typeof ResizeObserver === 'undefined' ? rows.map((_, index) => ({ index, start: index * ROW_H, size: ROW_H })) : virtualizer.getVirtualItems();
    const selectedIndex = rows.findIndex((r) => r.id === selectedId);

    // keep the selected row in view when the selection moves
    useEffect(() => {
        if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
    }, [selectedIndex]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const next = moveSelection(e.key, selectedIndex, rows.length);
        if (next >= 0 && rowsRef.current[next]) onSelect(rowsRef.current[next].id);
    };
    useEffect(() => {
        const handler = (e) => keyRef.current?.(e);
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    const date = (d) => new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(`${String(d).slice(0, 10)}T00:00:00`));
    const head = (column, label, align = '') => {
        const sortable = column === 'date' || column === 'amount';
        const state = ariaSort(sort, column);
        const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown;
        return (
            <div role="columnheader" aria-sort={sortable ? state : undefined} className={`flex min-h-[44px] items-center ${align}`}>
                {sortable ? (
                    <button type="button" onClick={() => onSort(toggleSort(sort, column))} className="flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-xs font-semibold uppercase tracking-wider text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink" data-testid={`sort-${column}`}>
                        {label}
                        {state !== 'none' ? <Icon size={13} aria-hidden="true" /> : null}
                    </button>
                ) : (
                    <span className="px-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</span>
                )}
            </div>
        );
    };

    return (
        <div role="table" aria-label={t('nav.activity')} aria-rowcount={rows.length + 1} className="flex min-h-0 flex-1 flex-col" data-testid="activity-table">
            <div role="row" className={`grid ${COLS} items-center gap-3 border-b border-line bg-ground px-4`}>
                {head('date', t('receipts.form.date'))}
                {head('merchant', t('pane.colMerchant'))}
                {head('category', t('pane.colCategory'))}
                {head('account', t('pane.colAccount'))}
                {head('amount', t('pane.colAmount'), 'justify-end')}
            </div>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2" tabIndex={-1}>
                <div role="rowgroup" style={{ height: virtualizer.getTotalSize() }} className="relative">
                    {items.map((v) => {
                        const tx = rows[v.index];
                        const selected = tx.id === selectedId;
                        const type = tx.transactionType || 'expense';
                        return (
                            <div
                                key={tx.id}
                                role="row"
                                aria-rowindex={v.index + 2}
                                aria-selected={selected}
                                tabIndex={selected || (selectedIndex < 0 && v.index === 0) ? 0 : -1}
                                onClick={() => onSelect(tx.id)}
                                onDoubleClick={() => onActivate(tx.id)}
                                data-testid="activity-row"
                                data-selected={selected ? 'true' : undefined}
                                className={`absolute inset-x-0 top-0 grid ${COLS} cursor-pointer items-center gap-3 rounded-xl px-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-forest-ink ${selected ? 'bg-mint' : 'hover:bg-tint'}`}
                                style={{ height: v.size, transform: `translateY(${v.start}px)` }}
                            >
                                <span role="cell" className="truncate text-ink-muted">{date(tx.date)}</span>
                                <span role="cell" className="flex min-w-0 items-center gap-2 text-ink">
                                    <span className="truncate font-medium">{tx.merchant || displayName(tx.merchant) || t('dashboard.topMerchants.unknown')}</span>
                                    {syncStates?.get(tx.id)?.overall ? <RecordSyncBadge state={syncStates.get(tx.id).overall} compact /> : null}
                                </span>
                                <span role="cell" className="truncate text-ink-muted">{type === 'income' ? t('quickAdd.income') : type === 'transfer' ? t('activity.transferLabel') : localizeCategory(tx.category || 'Other')}</span>
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
