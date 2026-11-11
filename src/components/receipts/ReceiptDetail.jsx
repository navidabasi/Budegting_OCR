import { useMemo, useState } from 'react';
import { Check, ChevronLeft, Copy, Edit3, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Chip, ChipRow, IconButton, Sheet } from '../ui';
import Amount from '../ui/Amount';
import ImageViewer from '../scan/ImageViewer';
import RecordSyncBadge from '../sync/RecordSyncBadge';
import { PendingTotalCard, SuggestedTotalCard } from './CaptureNotices';
import ItemReviewList from './ItemReviewList';
import ConversionCard from './ConversionCard';
import { BulkChangeSheet } from './ItemEditor';
import { useUserPrefs } from '../../hooks/useUserPrefs';
import { applyBulkItemChange, saveItemRule, saveItems } from '../../services/itemCorrections';
import { previewBulkItemChange } from '../../utils/itemRules';
import { normalizeItems } from '../../utils/receiptItems';
import { useRecordSyncStates } from '../../data/syncHooks';
import { resolveReceiptBackTarget } from '../../utils/helpers';
import { useAccounts, useDeleteTransaction, useMarkTransactionDone, useReceiptImage, useTransactions, useUpdateTransaction } from '../../data/hooks';
import { useCategories } from '../../hooks/useCategories';
import { useAppStore } from '../../store/appStore';
import { getTrackingStatus, isTrackedReceipt } from '../../utils/tracking';
import { getEffectiveAmount } from '../../utils/helpers';
import { ME, readSplit } from '../../utils/splits';
import { useCategoryChange } from '../../hooks/useCategoryChange';
import { countSameMerchant } from '../../services/categoryLearning';
import { rankCategories, dateKey } from '../../utils/quickAdd';
import { currencySymbol, localeFor, formatAmount } from '../../utils/format';
import { displayName } from '../../utils/merchant';
import { categoryVisual } from '../../utils/categoryVisual.jsx';
import { useTranslation } from '../../languages/useTranslation';

const card = 'rounded-[18px] bg-surface shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line';
const cap = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';

function Kv({ label, children, last }) {
    return (
        <div className={`flex min-h-[44px] items-baseline gap-3 py-2.5 text-[15px] text-ink ${last ? '' : 'border-b border-line'}`}>
            <span className="min-w-[84px] shrink-0 text-[13px] text-ink-muted">{label}</span>
            <span className="min-w-0 flex-1 break-words">{children}</span>
        </div>
    );
}

const withoutSuggestion = (receipt, field) => {
    const { [field]: _dropped, ...rest } = receipt.extraction?.suggested || {};
    return { ...receipt.extraction, suggested: rest };
};

/** Transaction detail (docs/design/Detail.dc.html). */
export default function ReceiptDetail({ receipt, onUpdate, onDelete }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const showToast = useAppStore((s) => s.showToast);
    const openQuickAdd = useAppStore((s) => s.openQuickAdd);
    const applyChange = useCategoryChange();
    const updateReceipt = useUpdateTransaction();
    const deleteReceipt = useDeleteTransaction();
    const markDone = useMarkTransactionDone();
    const { accounts } = useAccounts();
    const { transactions } = useTransactions();
    const categoryList = useCategories();
    const image = useReceiptImage(receipt);
    const syncStates = useRecordSyncStates(useMemo(() => [receipt], [receipt]));
    const sync = syncStates.get(receipt.id);
    const [viewer, setViewer] = useState(false);
    const [menu, setMenu] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [allCategories, setAllCategories] = useState(false);
    const [busy, setBusy] = useState(false);
    const [showItems, setShowItems] = useState(false);
    const [bulk, setBulk] = useState(null); // { item, preview }
    const { prefs, setPrefs } = useUserPrefs();
    const userId = useAppStore((s) => s.currentUser?.userId);

    const type = receipt.transactionType || 'expense';
    const status = getTrackingStatus(receipt);
    const locale = localeFor(languageCode, receipt.currency);
    const backTarget = resolveReceiptBackTarget(receipt.id, location.state?.returnTo || '/activity');
    const account = accounts.find((a) => a.id === receipt.accountId);
    const toAccount = accounts.find((a) => a.id === receipt.toAccountId);
    const names = useMemo(() => categoryList.map((c) => (typeof c === 'string' ? c : c.name)).filter((n) => n !== 'Income' && n !== 'Transfer'), [categoryList]);
    const ranked = useMemo(() => rankCategories({ suggested: receipt.category, transactions, names, limit: 4 }), [receipt.category, transactions, names]);
    const items = useMemo(() => normalizeItems(receipt.lineItems, receipt.category), [receipt.lineItems, receipt.category]);
    const sameMerchantCount = useMemo(() => countSameMerchant(transactions, receipt), [transactions, receipt]);
    const { Icon: CatIcon } = categoryVisual(receipt.category, type);

    const dateText = (() => {
        const d = new Date(`${String(receipt.date).slice(0, 10)}T00:00:00`);
        if (Number.isNaN(d.getTime())) return '';
        return new Intl.DateTimeFormat(languageCode, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    })();
    const subtitle = [dateText, receipt.extraction?.time, type === 'transfer' ? [account?.name, toAccount?.name].filter(Boolean).join(' → ') : account?.name].filter(Boolean).join(' · ');

    const splitV2 = readSplit(receipt.splitData, receipt.total);
    const split = splitV2
        ? [
              t('detail.yourShare', { amount: `${formatAmount(getEffectiveAmount(receipt), { locale })} ${currencySymbol(receipt.currency, locale)}` }),
              t('shared.splitSummary', { count: splitV2.participants.length }),
              t('shared.paidByName', { name: splitV2.payer === ME ? t('shared.me') : splitV2.participants.find((p) => p.id === splitV2.payer)?.name || '?' }),
          ].join(' · ')
        : null;

    const changeCategory = async (category) => {
        try {
            await applyChange(receipt, category);
            onUpdate?.();
        } catch {
            showToast(t('quickAdd.saveFailed'), 'error');
        }
    };

    const remove = async () => {
        setBusy(true);
        try {
            await deleteReceipt(receipt.id);
            showToast(t('receipts.detail.deleteSuccess'), 'success');
            navigate(backTarget, { replace: true });
            onDelete?.();
        } catch {
            showToast(t('receipts.detail.deleteFailed'), 'error');
            setBusy(false);
        }
    };

    const markPaid = async () => {
        setBusy(true);
        try {
            await markDone(receipt.id);
            onUpdate?.();
            showToast(receipt.recurringData?.isActive ? t('receipts.tracking.markRecurringSuccess') : t('receipts.tracking.markSuccess'), 'success');
        } catch (err) {
            showToast(err.message || t('receipts.tracking.markFailed'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const duplicate = () => {
        const { id, createdAt, updatedAt, imagePath, extraction, importRef, trackingData, ...rest } = receipt;
        openQuickAdd({ initial: { ...rest, date: dateKey(0), trackingData: null } });
    };

    const actionBtn = 'flex h-12 flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-line-strong bg-surface text-sm font-semibold text-ink active:opacity-80';

    return (
        <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col">
            <div className="flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),12px)]">
                <IconButton label={t('common.actions.back')} icon={ChevronLeft} size={22} onClick={() => navigate(backTarget)} />
                <span className="text-[13px] font-semibold uppercase tracking-wider text-ink-muted">{type === 'income' ? t('quickAdd.income') : type === 'transfer' ? t('quickAdd.transfer') : t('quickAdd.expense')}</span>
                <IconButton label={t('detail.moreActions')} icon={MoreHorizontal} onClick={() => setMenu(true)} />
            </div>

            <div className="flex items-center gap-3.5 px-5 pb-3 pt-1.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h1 className="break-words font-display text-[26px] font-bold leading-tight tracking-tight text-ink">{receipt.merchant}</h1>
                    <span className="text-[13px] text-ink-muted">{subtitle}</span>
                    <div className="mt-1.5 flex items-baseline gap-1.5" dir="ltr">
                        <Amount value={receipt.total} className="text-4xl font-semibold leading-none tracking-tight" tone={status === 'open' ? 'muted' : type === 'income' ? 'income' : type === 'transfer' ? 'savings' : 'default'} />
                        <span className="font-mono text-base text-ink-muted">{currencySymbol(receipt.currency, locale)}</span>
                    </div>
                </div>
                {image.url ? (
                    <button type="button" onClick={() => setViewer(true)} aria-label={t('detail.openPhoto')} className="flex h-[108px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-tint">
                        <img src={image.url} alt={t('scan.receiptPhoto')} className="h-full w-full object-cover" />
                    </button>
                ) : null}
            </div>

            <div className="flex flex-1 flex-col gap-3 px-5 pb-4">
                <ConversionCard receipt={receipt} onSave={(patch) => updateReceipt(receipt.id, patch).then(() => onUpdate?.())} />
                {receipt.extraction?.pending ? <PendingTotalCard receipt={receipt} onSave={(total) => updateReceipt(receipt.id, { total }).then(() => onUpdate?.())} /> : null}
                <SuggestedTotalCard
                    receipt={receipt}
                    onUse={(total) => updateReceipt(receipt.id, { total, extraction: withoutSuggestion(receipt, 'total') }).then(() => onUpdate?.())}
                    onKeep={() => updateReceipt(receipt.id, { extraction: withoutSuggestion(receipt, 'total') }, { system: true }).then(() => onUpdate?.())}
                />
                {receipt.extraction?.failed ? <p className="rounded-[14px] bg-warn-soft px-3.5 py-3 text-sm text-warn-ink">{t('detail.readFailed')}</p> : null}

                {type === 'expense' ? (
                    <section className={`${card} flex flex-col gap-2 px-4 py-3`}>
                        <div className="flex items-baseline justify-between">
                            <span className={cap}>{t('quickAdd.categoryLabel').split(' · ')[0]}</span>
                        </div>
                        {sameMerchantCount > 1 ? (
                            <p className="text-xs text-ink-muted" data-testid="applies-hint">
                                {t('learning.appliesTo', { count: sameMerchantCount, merchant: displayName(receipt.merchant) || receipt.merchant })}
                            </p>
                        ) : null}
                        {allCategories ? (
                            <div className="flex flex-wrap gap-2">
                                {names.map((n) => (
                                    <Chip key={n} size="sm" selected={receipt.category === n} onClick={() => changeCategory(n)}>
                                        {localizeCategory(n)}
                                    </Chip>
                                ))}
                                <Chip size="sm" aria-expanded="true" onClick={() => setAllCategories(false)}>
                                    {t('quickAdd.categoryLess')}
                                </Chip>
                            </div>
                        ) : (
                            <ChipRow className="!-mx-4 !px-4">
                                {[...new Set([receipt.category, ...ranked.top])].filter(Boolean).slice(0, 4).map((n) => (
                                    <Chip key={n} size="sm" selected={receipt.category === n} onClick={() => changeCategory(n)}>
                                        {localizeCategory(n)}
                                    </Chip>
                                ))}
                                <Chip size="sm" aria-expanded="false" onClick={() => setAllCategories(true)}>
                                    {t('detail.otherCategory')}
                                </Chip>
                            </ChipRow>
                        )}
                    </section>
                ) : null}

                <section className={`${card} px-4`}>
                    {account || toAccount ? <Kv label={t('scan.account')}>{type === 'transfer' ? [account?.name, toAccount?.name].filter(Boolean).join(' → ') : account?.name}</Kv> : null}
                    <Kv label={t('quickAdd.group')}>{receipt.groupName || <span className="text-ink-faint">{t('receipts.form.noGroup')}</span>}</Kv>
                    <Kv label={t('quickAdd.tags')}>{receipt.groupTags?.length ? receipt.groupTags.join(', ') : <span className="text-ink-faint">—</span>}</Kv>
                    {split ? <Kv label={t('receipts.split.title')}>{split}</Kv> : null}
                    {receipt.recurringData?.isActive ? <Kv label={t('detail.repeats')}>{t(`receipts.recurring.${receipt.recurringData.frequency}`)}</Kv> : null}
                    {sync ? (
                        <Kv label={t('sync.label')}>
                            <span className="flex flex-col gap-1" data-testid="detail-sync">
                                <RecordSyncBadge state={sync.record} />
                                {sync.image ? (
                                    <span className="flex items-center gap-2 text-xs text-ink-muted">
                                        {t('sync.part.image')}: <RecordSyncBadge state={sync.image} />
                                    </span>
                                ) : null}
                                {sync.analysis ? (
                                    <span className="flex items-center gap-2 text-xs text-ink-muted">
                                        {t('sync.part.analysis')}: <RecordSyncBadge state={sync.analysis} />
                                    </span>
                                ) : null}
                            </span>
                        </Kv>
                    ) : null}
                    {status ? <Kv label={t('detail.status')}>{status === 'open' ? t('activity.unpaid') : t('detail.paid')}</Kv> : null}
                    <Kv label={t('quickAdd.notes')} last>
                        {receipt.notes ? receipt.notes : (
                            <button type="button" onClick={() => openQuickAdd({ transaction: receipt })} className="min-h-[32px] text-ink-faint">
                                {t('detail.addNote')}
                            </button>
                        )}
                    </Kv>
                </section>

                {type === 'expense' && (items.length > 0 || receipt.imagePath || showItems) ? (
                    <section className={`${card} px-4 py-3`}>
                        <ItemReviewList
                            items={items}
                            receipt={receipt}
                            categoryNames={names}
                            customSubcategories={prefs.subcategories || {}}
                            highlightId={new URLSearchParams(location.search).get('item')}
                            onViewPhoto={image.url ? () => setViewer(true) : undefined}
                            onChange={(next) => saveItems(receipt, next).then(() => onUpdate?.()).catch(() => showToast(t('quickAdd.saveFailed'), 'error'))}
                            onFutureRule={(item) =>
                                saveItemRule(userId, item.name, { category: item.category, subcategory: item.subcategory }).then(() => showToast(t('items.ruleSaved', { name: item.name }), 'success'))
                            }
                            onBulkChange={(item) => setBulk({ item, preview: previewBulkItemChange(transactions, { name: item.name, category: item.category, subcategory: item.subcategory, excludeTxId: receipt.id }) })}
                            onAddSubcategory={(category, label) => setPrefs({ subcategories: { ...(prefs.subcategories || {}), [category]: [...new Set([...((prefs.subcategories || {})[category] || []), label])] } })}
                        />
                    </section>
                ) : type === 'expense' ? (
                    <button type="button" onClick={() => setShowItems(true)} className="flex h-12 items-center justify-center rounded-[14px] border border-line-strong bg-surface text-sm font-semibold text-ink">
                        {t('items.addItems')}
                    </button>
                ) : null}
            </div>

            <div className="sticky bottom-0 flex flex-col gap-2 bg-ground px-5 pt-2.5" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}>
                {status === 'open' ? (
                    <button type="button" disabled={busy} onClick={markPaid} className="flex h-14 items-center justify-center gap-2 rounded-[18px] bg-forest text-base font-semibold text-white active:scale-[0.98] disabled:opacity-50">
                        <Check size={20} strokeWidth={2.4} aria-hidden="true" />
                        {t('detail.markPaid')}
                    </button>
                ) : null}
                <div className="flex gap-2">
                    <button type="button" className={actionBtn} onClick={duplicate}>
                        <Copy size={16} aria-hidden="true" />
                        {t('detail.duplicate')}
                    </button>
                    <button type="button" className={actionBtn} onClick={() => openQuickAdd({ transaction: receipt })}>
                        <Edit3 size={16} aria-hidden="true" />
                        {t('common.actions.edit')}
                    </button>
                    <button type="button" className={`${actionBtn} !flex-none w-14 !text-over-ink`} aria-label={t('common.actions.delete')} onClick={() => setConfirmDelete(true)}>
                        <Trash2 size={18} aria-hidden="true" />
                    </button>
                </div>
            </div>

            <BulkChangeSheet
                open={!!bulk}
                onClose={() => setBulk(null)}
                preview={bulk?.preview || []}
                itemName={bulk?.item?.name || ''}
                busy={busy}
                onApply={async () => {
                    setBusy(true);
                    try {
                        const r = await applyBulkItemChange(transactions, bulk.preview);
                        setBulk(null);
                        showToast(t('items.bulkDone', { count: r.count }), 'success', {
                            action: { label: t('quickAdd.undo'), onClick: () => r.undo().then(() => showToast(t('items.bulkUndone'), 'info')) },
                        });
                    } catch {
                        showToast(t('quickAdd.saveFailed'), 'error');
                    } finally {
                        setBusy(false);
                    }
                }}
            />

            {viewer && image.url ? <ImageViewer src={image.url} alt={t('scan.receiptPhoto')} onClose={() => setViewer(false)} /> : null}

            <Sheet open={menu} onClose={() => setMenu(false)} label={t('detail.moreActions')}>
                <div className="flex flex-col px-3 pb-2">
                    <button
                        type="button"
                        className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-[15px] text-ink active:bg-line"
                        onClick={async () => {
                            setMenu(false);
                            await updateReceipt(receipt.id, { isPinned: !receipt.isPinned });
                            onUpdate?.();
                        }}
                    >
                        {receipt.isPinned ? <PinOff size={18} aria-hidden="true" /> : <Pin size={18} aria-hidden="true" />}
                        {receipt.isPinned ? t('detail.unpin') : t('detail.pin')}
                    </button>
                </div>
            </Sheet>

            <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} label={t('receipts.detail.deleteTitle')}>
                <div className="flex flex-col gap-3 px-5 pb-2">
                    <h2 className="font-display text-lg font-bold text-ink">{t('receipts.detail.deleteTitle')}</h2>
                    <p className="text-sm text-ink-muted">{t('receipts.detail.deleteConfirmMessage')}</p>
                    <button type="button" disabled={busy} onClick={remove} className="h-14 rounded-[18px] bg-over text-base font-semibold text-white disabled:opacity-50" data-autofocus>
                        {t('common.actions.delete')}
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)} className="h-12 rounded-[18px] text-sm font-semibold text-ink-muted">
                        {t('common.actions.cancel')}
                    </button>
                </div>
            </Sheet>
        </div>
    );
}
