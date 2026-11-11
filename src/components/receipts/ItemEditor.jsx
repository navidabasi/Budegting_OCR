import { useEffect, useMemo, useState } from 'react';
import { Camera, Plus } from 'lucide-react';
import { Chip, ChipRow, Sheet } from '../ui';
import { editItem, normalizeItem, UNITS } from '../../utils/receiptItems';
import { subcategoriesFor } from '../../utils/categoryNames';
import { subcategoryLabel } from './subcategoryLabel';
import { decimalSeparator, localeFor } from '../../utils/format';
import { useTranslation } from '../../languages/useTranslation';

const cap = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';
const input = 'h-12 min-w-0 rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink';
const newId = () => globalThis.crypto?.randomUUID?.() || `it-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;

const parse = (v) => {
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

/** Edit one receipt line. A category change applies to this line only unless "also for future purchases" is chosen explicitly. */
export function ItemSheet({ open, item, receipt, categoryNames, customSubcategories, onClose, onSave, onRemove, onBulkChange, onAddSubcategory, onViewPhoto }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const locale = localeFor(languageCode, receipt?.currency);
    const isNew = !item;
    const [form, setForm] = useState(null);
    const [scope, setScope] = useState('item');
    const [custom, setCustom] = useState('');

    useEffect(() => {
        if (!open) return;
        const base = item ? normalizeItem(item) : normalizeItem({ v: 2, id: newId(), name: '', amount: null, category: receipt?.category || '', reviewStatus: 'confirmed', userEdited: [] });
        setForm({
            name: base.name,
            amount: base.amount === null ? '' : String(base.amount).replace('.', decimalSeparator(locale)),
            category: base.category,
            subcategory: base.subcategory || '',
            quantity: base.quantity ?? '',
            unit: base.unit || '',
        });
        setScope('item');
        setCustom('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, item?.id]);

    const subs = useMemo(() => (form ? subcategoriesFor(form.category, customSubcategories) : []), [form, customSubcategories]);
    if (!form) return null;

    const amount = parse(form.amount);
    const base = item ? normalizeItem(item) : null;
    const categoryChanged = !!base && (form.category !== base.category || (form.subcategory || '') !== (base.subcategory || ''));
    const canSave = form.name.trim() && amount !== null;
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const save = () => {
        if (!canSave) return;
        const patch = {
            name: form.name.trim(),
            amount: Math.round(amount * 100) / 100,
            category: form.category,
            subcategory: form.subcategory || null,
            quantity: parse(form.quantity) ?? undefined,
            unit: form.unit || undefined,
        };
        if (isNew) {
            onSave(normalizeItem({ v: 2, id: newId(), ...patch, reviewStatus: 'confirmed', userEdited: ['name', 'amount', 'category'] }), { scope: 'item' });
            return;
        }
        const next = editItem(base, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
        // Confirming without changes still marks the line as reviewed
        onSave(next.reviewStatus === 'confirmed' ? next : { ...next, reviewStatus: 'confirmed' }, { scope: categoryChanged ? scope : 'item' });
    };

    return (
        <Sheet open={open} onClose={onClose} label={isNew ? t('items.add') : t('items.edit')}>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-2" data-testid="item-sheet">
                <h2 className="font-display text-lg font-bold text-ink">{isNew ? t('items.add') : t('items.edit')}</h2>
                {base?.rawText ? (
                    <div className="flex items-center gap-2 rounded-[14px] bg-tint px-3.5 py-2.5">
                        <p className="min-w-0 flex-1 break-words font-mono text-xs text-ink-muted" dir="auto">
                            {t('items.asPrinted')}: {base.rawText}
                        </p>
                        {onViewPhoto ? (
                            <button type="button" aria-label={t('items.viewPhoto')} onClick={onViewPhoto} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-forest-ink">
                                <Camera size={18} aria-hidden="true" />
                            </button>
                        ) : null}
                    </div>
                ) : null}

                <label htmlFor="item-name" className={cap}>
                    {t('items.itemName')}
                </label>
                <input id="item-name" className={input} value={form.name} onChange={(e) => set({ name: e.target.value })} data-autofocus />

                <label htmlFor="item-amount" className={cap}>
                    {t('items.amount')}
                </label>
                <input id="item-amount" inputMode="decimal" dir="ltr" className={`${input} font-mono`} value={form.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.,-]/g, '') })} />

                <span className={cap}>{t('items.category')}</span>
                <ChipRow>
                    {categoryNames.map((n) => (
                        <Chip key={n} selected={form.category === n} onClick={() => set({ category: n, subcategory: n === form.category ? form.subcategory : '' })}>
                            {localizeCategory(n)}
                        </Chip>
                    ))}
                </ChipRow>

                {subs.length > 0 || form.category === 'Groceries' ? (
                    <>
                        <span className={cap}>{t('items.subcategory')}</span>
                        <div className="flex flex-wrap gap-2">
                            {subs.map((s) => (
                                <Chip key={s} size="sm" selected={form.subcategory === s} onClick={() => set({ subcategory: form.subcategory === s ? '' : s })}>
                                    {subcategoryLabel(t, s)}
                                </Chip>
                            ))}
                        </div>
                        {onAddSubcategory ? (
                            <div className="flex gap-2">
                                <input aria-label={t('items.newSubcategory')} placeholder={t('items.newSubcategory')} className={`${input} flex-1`} value={custom} onChange={(e) => setCustom(e.target.value)} />
                                <button
                                    type="button"
                                    aria-label={t('items.addSubcategory')}
                                    disabled={!custom.trim()}
                                    onClick={() => {
                                        const label = custom.trim();
                                        onAddSubcategory(form.category, label);
                                        set({ subcategory: label });
                                        setCustom('');
                                    }}
                                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-line-strong bg-surface text-ink disabled:opacity-40"
                                >
                                    <Plus size={18} aria-hidden="true" />
                                </button>
                            </div>
                        ) : null}
                    </>
                ) : null}

                <div className="flex gap-2">
                    <div className="flex flex-1 flex-col gap-1">
                        <label htmlFor="item-qty" className={cap}>
                            {t('items.quantity')}
                        </label>
                        <input id="item-qty" inputMode="decimal" dir="ltr" className={`${input} font-mono`} value={form.quantity} onChange={(e) => set({ quantity: e.target.value.replace(/[^\d.,]/g, '') })} />
                    </div>
                    <div className="flex flex-1 flex-col gap-1">
                        <label htmlFor="item-unit" className={cap}>
                            {t('items.unit')}
                        </label>
                        <select id="item-unit" className={input} value={form.unit} onChange={(e) => set({ unit: e.target.value })}>
                            <option value="">-</option>
                            {UNITS.map((u) => (
                                <option key={u} value={u}>
                                    {u}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {categoryChanged ? (
                    <fieldset className="flex flex-col gap-1 rounded-[14px] border border-line-strong p-2" data-testid="scope">
                        <legend className="px-1 text-xs font-semibold text-ink-muted">{t('items.scopeTitle')}</legend>
                        {[
                            ['item', t('items.scopeItem')],
                            ['future', t('items.scopeFuture', { name: form.name.trim() || '...' })],
                        ].map(([value, label]) => (
                            <label key={value} className="flex min-h-[44px] cursor-pointer items-center gap-3 px-2 text-sm text-ink">
                                <input type="radio" name="item-scope" value={value} checked={scope === value} onChange={() => setScope(value)} className="h-5 w-5" />
                                {label}
                            </label>
                        ))}
                    </fieldset>
                ) : null}

                <button type="button" onClick={save} disabled={!canSave} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40" data-testid="item-save">
                    {t('items.saveItem')}
                </button>
                {!isNew && onBulkChange && categoryChanged ? (
                    <button type="button" onClick={() => onBulkChange({ ...base, name: form.name.trim(), category: form.category, subcategory: form.subcategory || null })} className="h-12 rounded-[18px] border border-line-strong bg-surface text-sm font-semibold text-ink">
                        {t('items.previewHistory')}
                    </button>
                ) : null}
                {!isNew ? (
                    <button type="button" onClick={() => onRemove(base.id)} className="h-12 rounded-[18px] text-sm font-semibold text-over-ink">
                        {t('items.remove')}
                    </button>
                ) : null}
            </div>
        </Sheet>
    );
}

/** Preview of a change to past purchases of one product: every affected line is listed, nothing is written until confirmed. */
export function BulkChangeSheet({ open, onClose, preview, itemName, onApply, busy }) {
    const { t, localizeCategory } = useTranslation();
    const receipts = new Set(preview.map((p) => p.txId)).size;
    const label = (x) => [x.category ? localizeCategory(x.category) : '-', x.subcategory ? subcategoryLabel(t, x.subcategory) : null].filter(Boolean).join(' · ');
    return (
        <Sheet open={open} onClose={onClose} label={t('items.bulkTitle')}>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-2" data-testid="bulk-sheet">
                <h2 className="font-display text-lg font-bold text-ink">{t('items.bulkTitle')}</h2>
                {preview.length === 0 ? (
                    <p className="text-sm text-ink-muted">{t('items.bulkNone', { name: itemName })}</p>
                ) : (
                    <>
                        <p className="text-sm text-ink-muted">{t('items.bulkBody', { count: preview.length, receipts, name: itemName })}</p>
                        <ul className="flex flex-col divide-y divide-line rounded-[14px] border border-line-strong">
                            {preview.slice(0, 12).map((p) => (
                                <li key={`${p.txId}-${p.itemId}`} className="flex flex-col px-3.5 py-2 text-sm">
                                    <span className="text-ink">
                                        {p.merchant} · {p.date}
                                    </span>
                                    <span className="text-xs text-ink-muted">
                                        {label(p.from)} → {label(p.to)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {preview.length > 12 ? <p className="text-xs text-ink-muted">{t('items.bulkMore', { count: preview.length - 12 })}</p> : null}
                        <p className="text-xs text-ink-muted">{t('items.bulkSkipEdited')}</p>
                        <button type="button" disabled={busy} onClick={onApply} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-50">
                            {t('items.bulkApply', { count: preview.length })}
                        </button>
                    </>
                )}
                <button type="button" onClick={onClose} className="h-12 rounded-[18px] text-sm font-semibold text-ink-muted">
                    {t('common.actions.cancel')}
                </button>
            </div>
        </Sheet>
    );
}
