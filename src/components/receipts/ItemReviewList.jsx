import { useMemo, useState } from 'react';
import { AlertTriangle, Camera, ChevronRight, Plus } from 'lucide-react';
import { Chip, ChipRow, Sheet } from '../ui';
import { ItemSheet } from './ItemEditor';
import { subcategoryLabel } from './subcategoryLabel';
import { assignDifference, normalizeItems, reconcile, uncertainFields } from '../../utils/receiptItems';
import { formatAmount, formatMoney, localeFor } from '../../utils/format';
import { useTranslation } from '../../languages/useTranslation';

const cap = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';


/**
 * Item review list (phone): one row per line with category/subcategory, amount and a flag where a field is uncertain; tap a row
 * to correct it. Below the list: how much of the receipt total the items explain, and "Assign the difference" for the rest.
 * Controlled: `items` in, `onChange(items)` out (the parent persists). A correction changes that one line unless the user
 * explicitly picks "also for future purchases" (onFutureRule) or previews a change to history (onBulkChange).
 */
export default function ItemReviewList({ items, receipt, categoryNames = [], customSubcategories = {}, onChange, onFutureRule, onBulkChange, onAddSubcategory, onViewPhoto, readOnly = false }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const [editing, setEditing] = useState(null); // item id | 'new'
    const [diffOpen, setDiffOpen] = useState(false);
    const list = useMemo(() => normalizeItems(items, receipt?.category), [items, receipt?.category]);
    const rec = useMemo(() => reconcile({ ...receipt, lineItems: list }), [receipt, list]);
    const locale = localeFor(languageCode, receipt?.currency);
    const money = (v) => formatMoney(v, receipt?.currency || 'EUR', locale);
    const toReview = list.filter((it) => uncertainFields(it).length > 0).length;
    const current = editing === 'new' ? null : list.find((it) => it.id === editing) || null;

    return (
        <section className="flex flex-col gap-1" data-testid="item-review-list" aria-label={t('items.title')}>
            <div className="flex items-baseline justify-between gap-2">
                <span className={cap}>{t('items.count', { count: list.length })}</span>
                {onViewPhoto ? (
                    <button type="button" onClick={onViewPhoto} className="flex h-11 items-center gap-1.5 px-2 text-[13px] font-semibold text-forest-ink">
                        <Camera size={15} aria-hidden="true" />
                        {t('items.viewPhoto')}
                    </button>
                ) : null}
            </div>
            {toReview > 0 ? <p className="text-xs font-medium text-warn-ink">{t('items.toReview', { count: toReview })}</p> : null}

            <ul className="flex flex-col">
                {list.map((it) => {
                    const flags = uncertainFields(it);
                    const sub = subcategoryLabel(t, it.subcategory);
                    return (
                        <li key={it.id} className="border-b border-line last:border-b-0">
                            <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => setEditing(it.id)}
                                className="flex min-h-[56px] w-full items-center gap-3 py-2 text-start disabled:cursor-default"
                                data-testid="item-row"
                                data-review={it.reviewStatus}
                            >
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className={`truncate text-[15px] ${it.name ? 'text-ink' : 'text-warn-ink'}`}>{it.name || t('detail.unreadableLine')}</span>
                                    <span className="flex items-center gap-1.5 truncate text-xs text-ink-muted">
                                        <span className="truncate">{[it.category ? localizeCategory(it.category) : null, sub || null].filter(Boolean).join(' · ') || t('items.noCategory')}</span>
                                        {it.quantity && it.unit ? <span className="shrink-0">{`${it.quantity} ${it.unit}`}</span> : null}
                                    </span>
                                </span>
                                {flags.length > 0 ? (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn-ink">
                                        <AlertTriangle size={11} aria-hidden="true" />
                                        {t('items.check')}
                                    </span>
                                ) : null}
                                <span className="shrink-0 font-mono text-[15px] text-ink" dir="ltr">
                                    {it.amount === null ? '?' : formatAmount(it.amount, { locale })}
                                </span>
                                {!readOnly ? <ChevronRight size={16} className="shrink-0 text-ink-faint rtl:rotate-180" aria-hidden="true" /> : null}
                            </button>
                        </li>
                    );
                })}
            </ul>

            {!readOnly ? (
                <button type="button" onClick={() => setEditing('new')} className="flex h-11 items-center gap-1.5 self-start rounded-xl px-2 text-sm font-semibold text-forest-ink">
                    <Plus size={16} aria-hidden="true" />
                    {t('items.add')}
                </button>
            ) : null}

            <div className="mt-1 flex flex-col gap-1 rounded-[14px] bg-tint px-3.5 py-2.5 text-sm" data-testid="reconcile" data-status={rec.status}>
                {rec.status === 'no_items' ? (
                    <span className="text-ink-muted">{t('items.noItems', { total: money(rec.total) })}</span>
                ) : (
                    <>
                        <span className="text-ink">{t('items.addUp', { sum: money(rec.itemsSum), total: money(rec.total) })}</span>
                        {rec.status === 'shortfall' ? <span className="text-warn-ink">{t('items.shortfall', { amount: money(rec.unallocated) })}</span> : null}
                        {rec.status === 'excess' ? <span className="text-warn-ink">{t('items.excess', { amount: money(Math.abs(rec.unallocated)) })}</span> : null}
                        {rec.status === 'complete' ? <span className="text-income">{t('items.balanced')}</span> : null}
                    </>
                )}
                {rec.unknownCount > 0 ? <span className="text-warn-ink">{t('items.unknownAmounts', { count: rec.unknownCount })}</span> : null}
                {!readOnly && rec.hasItems && (rec.status === 'shortfall' || rec.status === 'excess') ? (
                    <button type="button" onClick={() => setDiffOpen(true)} className="mt-1 h-11 self-start rounded-[12px] border border-line-strong bg-surface px-3.5 text-sm font-semibold text-ink">
                        {t('items.assignDifference')}
                    </button>
                ) : null}
            </div>

            <ItemSheet
                open={!!editing}
                item={current}
                receipt={receipt}
                categoryNames={categoryNames}
                customSubcategories={customSubcategories}
                onClose={() => setEditing(null)}
                onSave={(next, { scope }) => {
                    const exists = list.some((it) => it.id === next.id);
                    onChange(exists ? list.map((it) => (it.id === next.id ? next : it)) : [...list, next]);
                    if (scope === 'future') onFutureRule?.(next);
                    setEditing(null);
                }}
                onRemove={(id) => {
                    onChange(list.filter((it) => it.id !== id));
                    setEditing(null);
                }}
                onBulkChange={onBulkChange}
                onAddSubcategory={onAddSubcategory}
                onViewPhoto={onViewPhoto}
            />

            <DifferenceSheet
                open={diffOpen}
                onClose={() => setDiffOpen(false)}
                amount={rec.unallocated}
                money={money}
                category={receipt?.category}
                categoryNames={categoryNames}
                onAssign={(category, name) => {
                    onChange(assignDifference({ ...receipt, lineItems: list }, { category, name }));
                    setDiffOpen(false);
                }}
            />
        </section>
    );
}

function DifferenceSheet({ open, onClose, amount, money, category, categoryNames, onAssign }) {
    const { t, localizeCategory } = useTranslation();
    const [cat, setCat] = useState(category || '');
    const [name, setName] = useState('');
    const label = amount > 0 ? t('items.assignShortfall', { amount: money(amount) }) : t('items.assignExcess', { amount: money(Math.abs(amount)) });
    return (
        <Sheet open={open} onClose={onClose} label={t('items.assignDifference')}>
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-2">
                <h2 className="font-display text-lg font-bold text-ink">{t('items.assignDifference')}</h2>
                <p className="text-sm text-ink-muted">{label}</p>
                <label className={cap} htmlFor="diff-name">
                    {t('items.itemName')}
                </label>
                <input id="diff-name" value={name} placeholder={amount > 0 ? t('items.adjustmentName') : t('items.discountName')} onChange={(e) => setName(e.target.value)} className="h-12 rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink focus:outline-none focus:ring-2 focus:ring-forest-ink" />
                <span className={cap}>{t('items.category')}</span>
                <ChipRow>
                    {categoryNames.map((n) => (
                        <Chip key={n} selected={cat === n} onClick={() => setCat(n)}>
                            {localizeCategory(n)}
                        </Chip>
                    ))}
                </ChipRow>
                <button type="button" onClick={() => onAssign(cat || category, name.trim() || (amount > 0 ? t('items.adjustmentName') : t('items.discountName')))} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white">
                    {t('items.assignConfirm')}
                </button>
                <button type="button" onClick={onClose} className="h-12 rounded-[18px] text-sm font-semibold text-ink-muted">
                    {t('common.actions.cancel')}
                </button>
            </div>
        </Sheet>
    );
}
