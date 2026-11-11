import { suggestForMerchant } from '../../services/categorizer';
import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronLeft } from 'lucide-react';
import { Chip, ChipRow, IconButton } from '../ui';
import MoreSection from '../quickadd/MoreSection';
import TripChip from '../plan/TripChip';
import { useTripGroup } from '../../hooks/useTripGroup';
import SplitManager from '../receipts/SplitManager';
import ImageViewer from './ImageViewer';
import { lowConfidenceFields } from '../../services/receiptScan';
import ItemReviewList from '../receipts/ItemReviewList';
import { reconcile, uncertainFields } from '../../utils/receiptItems';
import { useTranslation } from '../../languages/useTranslation';
import { decimalSeparator, formatAmount, formatMoney, localeFor } from '../../utils/format';
import { rankCategories } from '../../utils/quickAdd';

const lbl = 'text-[11px] font-semibold uppercase tracking-wider text-ink-muted';
const fieldBox = (check) =>
    `flex min-w-0 flex-col gap-1 rounded-[14px] border bg-surface px-3.5 py-2.5 ${check ? 'border-warn-edge shadow-[inset_4px_0_0_rgb(var(--c-warn-edge))]' : 'border-line'}`;

/**
 * Scan review (docs/design/ScanReview.dc.html). Controlled by ScanPage: `form` + `onChange`.
 */
export default function ReviewScreen({ result, form, onChange, imageUrl, accounts, groups, trips = [], categoryNames, transactions, rules = [], onCreateGroup, onSave, onManual, onRescan, onBack, saving, matches = [], onAttach, customSubcategories = {}, onAddSubcategory }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const [viewer, setViewer] = useState(false);
    const [itemsOpen, setItemsOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [allCats, setAllCats] = useState(false);
    const [splitOpen, setSplitOpen] = useState(false);

    const locale = localeFor(languageCode, form.currency);
    const sep = decimalSeparator(locale);
    const totalNum = parseFloat(String(form.total).replace(',', '.')) || 0;
    const low = useMemo(() => lowConfidenceFields({ ...result.receipt, merchant: form.merchant, date: form.date, total: form.total === '' ? null : totalNum }), [result, form.merchant, form.date, form.total, totalNum]);
    // A field the user already corrected is no longer flagged
    const edited = form.edited || {};
    const flag = (f) => low[f] && !edited[f];

    const { group, tripOfGroup, mergeMore, detach } = useTripGroup({ trips, date: form.date, more: form.more, detached: form.tripDetached });
    const items = form.items;
    const sum = reconcile({ total: totalNum, category: form.category, lineItems: items }).itemsSum;
    const unreadable = items.filter((it) => uncertainFields(it).length > 0).length;
    const set = (patch, field) => onChange({ ...form, ...patch, edited: field ? { ...edited, [field]: true } : edited });
    // P3-T5: a corrected merchant re-suggests the category, unless the user already picked one
    const changeMerchant = (merchant) => {
        const patch = { merchant };
        if (!form.categoryTouched) {
            const s = suggestForMerchant({ merchant, items, rules, transactions, names: categoryNames });
            if (s) Object.assign(patch, { category: s, suggested: s });
        }
        set(patch, 'merchant');
    };

    const ranked = useMemo(() => rankCategories({ suggested: form.suggested, transactions, names: categoryNames, limit: 4 }), [form.suggested, transactions, categoryNames]);
    const catChips = allCats ? ranked.all : ranked.top;
    const totalCheckText = items.length > 0 && Math.abs(sum - totalNum) > 0.005 ? t('scan.checkItemsAddUp', { sum: formatAmount(sum, { locale }) }) : t('scan.checkThis');
    const merchant = form.merchant.trim();
    const saveLabel = merchant ? t('scan.saveAt', { amount: formatMoney(totalNum, form.currency, locale), merchant }) : t('scan.save', { amount: formatMoney(totalNum, form.currency, locale) });
    const canSave = totalNum > 0 && !saving;

    return (
        <div className="flex min-h-[100dvh] flex-col bg-ground">
            <div className="flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),16px)] pb-1.5">
                <IconButton label={t('common.actions.back')} icon={ChevronLeft} size={22} onClick={onBack} />
                <h1 className="font-display text-[17px] font-bold text-ink">{t('scan.reviewTitle')}</h1>
                <button type="button" onClick={onRescan} className="h-11 px-3 text-sm font-semibold text-forest-ink">
                    {t('scan.rescan')}
                </button>
            </div>

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-5 pb-4 pt-1">
                {imageUrl ? (
                    <button type="button" onClick={() => setViewer(true)} aria-label={t('scan.tapToZoom')} className="relative flex h-44 shrink-0 items-start justify-center overflow-hidden rounded-[18px] bg-tint">
                        <img src={imageUrl} alt={t('scan.receiptPhoto')} className="h-full w-full object-contain" />
                        <span className="absolute bottom-2.5 end-3 rounded-lg bg-surface/85 px-2 py-1 text-[11px] font-semibold text-ink">{t('scan.tapToZoom')}</span>
                    </button>
                ) : null}

                <div className="flex gap-2">
                    <div className={`${fieldBox(flag('merchant'))} flex-1`}>
                        <label htmlFor="scan-merchant" className={lbl}>{t('quickAdd.where')}</label>
                        <input id="scan-merchant" className="w-full min-w-0 bg-transparent text-[17px] font-semibold leading-6 text-ink outline-none" value={form.merchant} onChange={(e) => changeMerchant(e.target.value)} />
                        {flag('merchant') ? <span className="text-[11px] font-semibold text-warn-ink">{t('scan.checkThis')}</span> : null}
                    </div>
                    <div className={`${fieldBox(flag('date'))} flex-[1.25]`}>
                        <label htmlFor="scan-date" className={lbl}>{t('receipts.form.date')}</label>
                        <input id="scan-date" type="date" className="w-full min-w-0 bg-transparent text-sm font-medium leading-6 text-ink outline-none" value={form.date} onChange={(e) => e.target.value && set({ date: e.target.value }, 'date')} />
                        {flag('date') ? <span className="text-[11px] font-semibold text-warn-ink">{t('scan.checkThis')}</span> : null}
                    </div>
                </div>

                <div className={fieldBox(flag('total'))}>
                    <div className="flex items-baseline justify-between gap-2">
                        <label htmlFor="scan-total" className={lbl}>{t('receipts.form.total')}</label>
                        {flag('total') ? <span className="text-[11px] font-semibold text-warn-ink">{totalCheckText}</span> : null}
                    </div>
                    <div className="flex items-baseline gap-1.5" dir="ltr">
                        <input
                            id="scan-total"
                            inputMode="decimal"
                            className="w-36 bg-transparent font-mono text-[30px] font-semibold text-ink outline-none"
                            value={form.total}
                            onChange={(e) => set({ total: e.target.value.replace(/[^\d.,]/g, '') }, 'total')}
                        />
                        <span className="font-mono text-[15px] text-ink-muted">
                            {formatMoney(0, form.currency, locale).replace(/[\d.,\s ]/g, '')}
                            {result.receipt.paymentMethod !== 'unknown' ? ` · ${t(`scan.pay.${result.receipt.paymentMethod}`)}` : ''}
                        </span>
                    </div>
                </div>

                {matches.length > 0 ? (
                    <div className="flex flex-col gap-2 rounded-[14px] bg-mint px-3.5 py-3" data-testid="attach-card">
                        <p className="text-sm font-semibold text-forest-ink">{t('capture.attachTitle')}</p>
                        {matches.slice(0, 2).map((m) => (
                            <div key={m.transaction.id} className="flex items-center gap-2">
                                <p className="min-w-0 flex-1 text-sm text-forest-ink">
                                    {t('capture.attachBody', { merchant: m.transaction.merchant || '-', amount: formatMoney(Number(m.transaction.total), m.transaction.currency, locale), date: String(m.transaction.date).slice(0, 10) })}
                                </p>
                                <button type="button" disabled={saving} onClick={() => onAttach(m.transaction)} className="h-11 shrink-0 rounded-[12px] bg-forest px-3.5 text-sm font-semibold text-white disabled:opacity-50">
                                    {t('capture.attach')}
                                </button>
                            </div>
                        ))}
                    </div>
                ) : null}

                <div className="flex flex-col gap-2">
                    <span className={lbl}>{t('scan.categoryLabel')}</span>
                    {allCats ? (
                        <div className="flex flex-wrap gap-2">
                            {catChips.map((n) => (
                                <Chip key={n} size="sm" selected={form.category === n} onClick={() => set({ category: n, categoryTouched: true })}>{localizeCategory(n)}</Chip>
                            ))}
                            <Chip size="sm" aria-expanded="true" onClick={() => setAllCats(false)}>{t('quickAdd.categoryLess')}</Chip>
                        </div>
                    ) : (
                        <ChipRow>
                            {catChips.map((n) => (
                                <Chip key={n} size="sm" selected={form.category === n} onClick={() => set({ category: n, categoryTouched: true })}>{localizeCategory(n)}</Chip>
                            ))}
                            {ranked.all.length > catChips.length ? <Chip size="sm" aria-expanded="false" onClick={() => setAllCats(true)}>{t('quickAdd.categoryMore')}</Chip> : null}
                        </ChipRow>
                    )}
                </div>

                {items.length > 0 ? (
                    <div className="rounded-[14px] border border-line bg-surface">
                        <button type="button" aria-expanded={itemsOpen} onClick={() => setItemsOpen(!itemsOpen)} className="flex min-h-[44px] w-full items-center justify-between px-3.5 py-3 text-start text-ink">
                            <span className="flex flex-col gap-0.5">
                                <span className="text-[15px] font-semibold">{t('scan.itemsFound', { count: items.length })}</span>
                                {unreadable > 0 ? <span className="text-xs text-warn-ink">{t('scan.unreadable', { count: unreadable })}</span> : null}
                            </span>
                            <span className="flex items-center gap-2">
                                <span className="font-mono text-sm" dir="ltr">{formatAmount(sum, { locale })}</span>
                                <ChevronDown size={18} className={`text-ink-faint transition-transform ${itemsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                            </span>
                        </button>
                        {itemsOpen ? (
                            <div className="border-t border-line px-3.5 py-3">
                                <ItemReviewList
                                    items={items}
                                    receipt={{ total: totalNum, currency: form.currency, category: form.category }}
                                    categoryNames={categoryNames}
                                    customSubcategories={customSubcategories}
                                    onAddSubcategory={onAddSubcategory}
                                    onViewPhoto={imageUrl ? () => setViewer(true) : undefined}
                                    onChange={(next) => set({ items: next })}
                                />
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {tripOfGroup ? <TripChip name={tripOfGroup.name} onRemove={() => onChange({ ...form, ...detach() })} /> : null}

                <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)} className="flex min-h-[44px] items-center justify-between rounded-[14px] px-3.5 text-sm font-semibold text-forest-ink">
                    <span>{t('scan.more')}</span>
                    <ChevronDown size={16} className={moreOpen ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" />
                </button>
                {moreOpen ? (
                    <div className="flex flex-col gap-3">
                        {accounts.length > 0 ? (
                            <div className="flex flex-col gap-2">
                                <span className={lbl}>{t('scan.account')}</span>
                                <ChipRow>
                                    {accounts.map((a) => (
                                        <Chip key={a.id} size="sm" selected={form.accountId === a.id} onClick={() => set({ accountId: a.id })}>{a.name}</Chip>
                                    ))}
                                </ChipRow>
                            </div>
                        ) : null}
                        <MoreSection
                            hide={['items', 'recurring', 'planned', 'currency']}
                            value={{ ...form.more, groupId: group.groupId, groupName: group.groupName }}
                            onChange={(more) => onChange({ ...form, ...mergeMore(more) })}
                            groups={groups}
                            date={form.date}
                            onOpenSplit={() => setSplitOpen(true)}
                            onCreateGroup={onCreateGroup}
                        />
                    </div>
                ) : null}
            </div>

            <div className="flex flex-col gap-2.5 bg-ground px-5 pt-2.5" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}>
                <button type="button" onClick={onSave} disabled={!canSave} className="flex h-14 items-center justify-center gap-2 rounded-[18px] bg-forest text-[17px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40">
                    <Check size={20} strokeWidth={2.4} aria-hidden="true" />
                    {saveLabel}
                </button>
                <button type="button" onClick={onManual} className="flex h-11 items-center justify-center text-sm font-semibold text-ink-muted">
                    {t('scan.enterManually')}
                </button>
            </div>

            {viewer && imageUrl ? <ImageViewer src={imageUrl} alt={t('scan.receiptPhoto')} onClose={() => setViewer(false)} /> : null}
            {splitOpen ? (
                <SplitManager
                    receipt={{ total: totalNum, currency: form.currency, splitData: form.more.splitData }}
                    onSave={(splitData) => {
                        set({ more: { ...form.more, splitData } });
                        setSplitOpen(false);
                    }}
                    onClose={() => setSplitOpen(false)}
                />
            ) : null}
        </div>
    );
}
