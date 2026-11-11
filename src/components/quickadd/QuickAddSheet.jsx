import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Camera, ChevronDown, Image as ImageIcon, X } from 'lucide-react';
import { Chip, ChipRow, IconButton, Segmented, Sheet } from '../ui';
import Keypad from './Keypad';
import MoreSection from './MoreSection';
import SplitManager from '../receipts/SplitManager';
import { useAppStore } from '../../store/appStore';
import {
    useAccounts,
    useCreateGroup,
    useCreateTransaction,
    useDeleteTransaction,
    useGoals,
    useGroupsData,
    useMerchantRules,
    useSettings,
    useTransactions,
    useUpdateTransaction,
} from '../../data/hooks';
import { useCategories } from '../../hooks/useCategories';
import { DEFAULT_CATEGORY } from '../../utils/constants';
import { suggestForMerchant } from '../../services/categorizer';
import { merchantKey } from '../../utils/merchant';
import { useTranslation } from '../../languages/useTranslation';
import { decimalSeparator, formatAmount, formatMoney, localeFor } from '../../utils/format';
import { displayExpression, evaluate, expressionFromNumber, keyFromEvent, pressKey } from '../../utils/amountInput';
import { categoryForMerchant, dateKey, getLastAccountId, rankCategories, recentMerchants, setLastAccountId } from '../../utils/quickAdd';
import { queueImage, requestImageFlush } from '../../data/images';
import { buildOpenTrackingData, normalizeTrackingData } from '../../utils/tracking';

const labelClass = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';
const emptyMore = () => ({ items: [], notes: '', groupId: null, groupName: null, tags: [], splitData: null, recurringData: null, planned: false, currency: 'EUR' });

function initialState(preset, defaultCurrency) {
    const src = preset?.transaction || preset?.initial || null;
    const more = emptyMore();
    more.currency = src?.currency || defaultCurrency || 'EUR';
    if (src) {
        more.items = (src.lineItems || []).map((it) => ({ name: it.name || '', price: it.price != null ? String(it.price) : '' }));
        more.notes = src.notes || '';
        more.groupId = src.groupId || null;
        more.groupName = src.groupName || null;
        more.tags = src.groupTags || [];
        more.splitData = src.splitData || null;
        more.recurringData = src.recurringData || null;
        more.planned = !!normalizeTrackingData(src.trackingData)?.isTracked;
    }
    return {
        type: src?.transactionType || 'expense',
        expr: expressionFromNumber(src?.total),
        merchant: src?.merchant || '',
        category: src?.category || '',
        categoryTouched: !!src?.category,
        date: src?.date ? String(src.date).slice(0, 10) : dateKey(0),
        accountId: src?.accountId || null,
        toAccountId: src?.toAccountId || null,
        goalId: src?.goalId || null,
        more,
        showMore: false,
        showAllCategories: false,
    };
}

/** Quick Add bottom sheet (docs/design/QuickAdd.dc.html). Amount first, everything else optional. */
export default function QuickAddSheet({ open, onClose, preset, onScan }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const currentUser = useAppStore((s) => s.currentUser);
    const showToast = useAppStore((s) => s.showToast);
    const { defaultCurrency } = useSettings();
    const { transactions } = useTransactions();
    const { accounts } = useAccounts();
    const { groups } = useGroupsData();
    const { goals } = useGoals();
    const { rules } = useMerchantRules();
    const categoryList = useCategories();
    const createTransaction = useCreateTransaction();
    const updateTransaction = useUpdateTransaction();
    const deleteTransaction = useDeleteTransaction();
    const createGroup = useCreateGroup();

    const [state, setState] = useState(() => initialState(preset, defaultCurrency));
    const [splitOpen, setSplitOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const dateInputRef = useRef(null);
    const editing = preset?.transaction || null;

    // Reset whenever the sheet opens
    useEffect(() => {
        if (!open) return;
        const next = initialState(preset, defaultCurrency);
        setState(next);
        setSplitOpen(false);
        setSaving(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, preset]);

    // Default account = last used (persisted), else first account
    useEffect(() => {
        if (!open || state.accountId || accounts.length === 0) return;
        const last = getLastAccountId();
        const pick = accounts.find((a) => a.id === last && a.id !== state.toAccountId) || accounts.find((a) => a.id !== state.toAccountId) || accounts[0];
        setState((s) => (s.accountId ? s : { ...s, accountId: pick.id }));
    }, [open, accounts, state.accountId]);

    // Currency follows the setting once loaded unless the sheet was opened with a transaction
    useEffect(() => {
        if (open && !preset && defaultCurrency) setState((s) => (s.more.currency === defaultCurrency ? s : { ...s, more: { ...s.more, currency: defaultCurrency } }));
    }, [open, preset, defaultCurrency]);

    const locale = localeFor(languageCode, state.more.currency);
    const sep = decimalSeparator(locale);
    const itemsSum = useMemo(() => state.more.items.reduce((sum, it) => sum + (parseFloat(String(it.price).replace(',', '.')) || 0), 0), [state.more.items]);
    const typed = evaluate(state.expr);
    const total = typed > 0 ? typed : Math.round(itemsSum * 100) / 100;

    const names = useMemo(() => categoryList.map((c) => (typeof c === 'string' ? c : c.name)).filter((n) => n !== 'Income' && n !== 'Transfer'), [categoryList]);
    const suggested = useMemo(() => {
        if (!state.merchant.trim()) return null;
        return suggestForMerchant({ merchant: state.merchant, rules, transactions, names });
    }, [state.merchant, transactions, rules, names]);
    const ranked = useMemo(() => rankCategories({ suggested, transactions, names, limit: 4 }), [suggested, transactions, names]);
    const merchantChips = useMemo(() => recentMerchants(transactions, { type: state.type === 'income' ? 'income' : 'expense' }), [transactions, state.type]);

    // Auto-pick the suggested category until the user chooses one
    useEffect(() => {
        if (state.categoryTouched || state.type !== 'expense') return;
        if (suggested && suggested !== state.category) setState((s) => ({ ...s, category: suggested }));
    }, [suggested, state.categoryTouched, state.type, state.category]);

    const set = (patch) => setState((s) => ({ ...s, ...patch }));
    const press = (key) => setState((s) => ({ ...s, expr: pressKey(s.expr, key) }));

    const onPanelKeyDown = (e) => {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = keyFromEvent(e.key);
        if (k) {
            e.preventDefault();
            press(k);
        } else if (e.key === 'Enter' && tag !== 'BUTTON') {
            e.preventDefault();
            save();
        }
    };

    const accountName = (id) => accounts.find((a) => a.id === id)?.name || '';
    const isTransfer = state.type === 'transfer';
    const canSave = total > 0 && (!isTransfer || (state.accountId && state.toAccountId && state.accountId !== state.toAccountId));

    async function save() {
        if (!canSave || saving || !currentUser) return;
        setSaving(true);
        const more = state.more;
        const merchant = state.merchant.trim();
        const items = more.items
            .filter((it) => it.name.trim() && it.price !== '')
            .map((it) => ({ name: it.name.trim(), quantity: 1, price: parseFloat(String(it.price).replace(',', '.')) || 0, category: state.category || '' }));
        const base = editing ? normalizeTrackingData(editing.trackingData) : null;
        const record = {
            merchantKey: !isTransfer && merchant ? merchantKey(merchant) : null,
            merchant: isTransfer ? t('quickAdd.transferTo', { account: accountName(state.toAccountId) }) : merchant,
            date: state.date,
            total,
            currency: more.currency,
            category: isTransfer ? 'Transfer' : state.type === 'income' ? 'Income' : state.category || DEFAULT_CATEGORY,
            lineItems: items,
            notes: more.notes,
            transactionType: state.type,
            accountId: state.accountId || null,
            toAccountId: isTransfer ? state.toAccountId : null,
            goalId: isTransfer ? state.goalId || null : null,
            groupId: more.groupId,
            groupName: more.groupName,
            groupTags: more.tags,
            splitData: more.splitData,
            recurringData: more.recurringData,
            trackingData: more.planned ? (base?.isTracked ? base : buildOpenTrackingData()) : null,
        };
        try {
            if (state.accountId) setLastAccountId(state.accountId);
            if (editing) {
                await updateTransaction(editing.id, record);
                showToast(t('quickAdd.savedEdit'), 'success');
            } else {
                const attach = preset?.image || null;
                const newTxId = attach ? (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`) : undefined;
                const imagePath = attach ? await queueImage({ userId: currentUser.userId, transactionId: newTxId, blob: attach }) : undefined;
                const id = await createTransaction({ ...record, userId: currentUser.userId, ...(attach ? { id: newTxId, imagePath } : {}) });
                if (attach) requestImageFlush(currentUser.userId);
                const money = formatMoney(total, more.currency, locale);
                const message = isTransfer
                    ? t('quickAdd.addedTransfer', { amount: money, account: accountName(state.toAccountId) })
                    : state.type === 'income'
                      ? t('quickAdd.addedIncome', { amount: money })
                      : merchant
                        ? t('quickAdd.addedAt', { amount: money, merchant })
                        : t('quickAdd.added', { amount: money });
                showToast(message, 'success', {
                    action: {
                        label: t('quickAdd.undo'),
                        onClick: () => deleteTransaction(id).then(() => showToast(t('quickAdd.removed'), 'info')).catch(() => showToast(t('quickAdd.saveFailed'), 'error')),
                    },
                });
            }
            onClose();
        } catch (err) {
            console.error('[QuickAdd] save failed', err);
            showToast(t('quickAdd.saveFailed'), 'error');
            setSaving(false);
        }
    }

    const today = dateKey(0);
    const yesterday = dateKey(1);
    const customDate = state.date !== today && state.date !== yesterday;
    const catChips = state.showAllCategories ? ranked.all : ranked.top;
    const typeOptions = [
        { value: 'expense', label: t('quickAdd.expense') },
        { value: 'income', label: t('quickAdd.income'), tone: 'income' },
        { value: 'transfer', label: t('quickAdd.transfer'), tone: 'savings' },
    ];
    const amountText = displayExpression(state.expr, sep) || '0';
    const hasPlus = state.expr.includes('+');

    const accountChips = (selectedId, onPick, labelKey) => (
        <div className="flex flex-col gap-2">
            {labelKey ? <span className={labelClass}>{t(labelKey)}</span> : null}
            <ChipRow>
                {accounts.map((a) => (
                    <Chip key={a.id} selected={selectedId === a.id} onClick={() => onPick(a.id)}>
                        {a.name}
                    </Chip>
                ))}
            </ChipRow>
        </div>
    );

    return (
        <>
        <Sheet open={open} onClose={onClose} label={editing ? t('quickAdd.editTitle') : t('quickAdd.title')} className="!max-h-[96dvh]">
            <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onPanelKeyDown}>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2">
                    <div className="flex flex-col gap-3.5">
                        <div className="flex items-center justify-between gap-3">
                            <Segmented options={typeOptions} value={state.type} onChange={(type) => set({ type, categoryTouched: type === 'expense' ? state.categoryTouched : false })} ariaLabel={t('quickAdd.type')} />
                            {!editing && onScan ? (
                                <div className="flex gap-2">
                                    <IconButton label={t('quickAdd.scanCamera')} variant="primary" icon={Camera} className="!h-11 !w-11 !rounded-[14px]" onClick={() => onScan('camera')} />
                                    <IconButton label={t('quickAdd.scanGallery')} variant="surface" icon={ImageIcon} className="!rounded-[14px] border border-line-strong" onClick={() => onScan('gallery')} />
                                </div>
                            ) : null}
                        </div>

                        <div
                            role="status"
                            aria-label={t('quickAdd.amount')}
                            dir="ltr"
                            className="flex items-baseline justify-center gap-2 pt-1.5 font-mono text-ink"
                            data-testid="amount-display"
                        >
                            <span className={`${hasPlus ? 'text-4xl' : 'text-[56px]'} font-semibold leading-none tracking-tight ${state.expr ? '' : 'text-ink-faint'}`}>{amountText}</span>
                            <span className="text-[22px] text-ink-muted">{formatMoney(0, state.more.currency, locale).replace(/[\d.,\s ]/g, '')}</span>
                        </div>
                        {hasPlus ? (
                            <p className="-mt-2 text-center font-mono text-sm text-ink-muted" dir="ltr">
                                = {formatAmount(typed, { locale })}
                            </p>
                        ) : null}

                        {preset?.image ? <p className="rounded-[14px] bg-mint px-3.5 py-2 text-sm text-forest-ink">{t('quickAdd.photoAttached')}</p> : null}

                        {isTransfer ? (
                            accounts.length >= 2 ? (
                                <>
                                    {accountChips(state.accountId, (id) => set({ accountId: id }), 'quickAdd.fromAccount')}
                                    {accountChips(state.toAccountId, (id) => set({ toAccountId: id }), 'quickAdd.toAccount')}
                                    {state.goalId && goals.find((g) => g.id === state.goalId) ? (
                                        <div>
                                            <Chip selected icon={X} onClick={() => set({ goalId: null })} aria-label={t('quickAdd.detachGoal')}>
                                                {t('quickAdd.goalChip', { goal: goals.find((g) => g.id === state.goalId).name })}
                                            </Chip>
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <p className="rounded-[14px] bg-warn-soft px-3.5 py-3 text-sm text-warn-ink">{t('quickAdd.needTwoAccounts')}</p>
                            )
                        ) : (
                            <div className="flex flex-col gap-2">
                                <label htmlFor="qa-merchant" className={labelClass}>
                                    {state.type === 'income' ? t('quickAdd.from') : t('quickAdd.where')}
                                </label>
                                <input
                                    id="qa-merchant"
                                    type="text"
                                    autoComplete="off"
                                    value={state.merchant}
                                    onChange={(e) => set({ merchant: e.target.value })}
                                    className="h-12 rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink"
                                />
                                {merchantChips.length > 0 ? (
                                    <ChipRow>
                                        {merchantChips.map((m) => (
                                            <Chip
                                                key={m}
                                                selected={state.merchant.trim().toLowerCase() === m.toLowerCase()}
                                                onClick={() => set({ merchant: m, category: state.type === 'expense' && !state.categoryTouched ? categoryForMerchant(transactions, m) || state.category : state.category })}
                                            >
                                                {m}
                                            </Chip>
                                        ))}
                                    </ChipRow>
                                ) : null}
                            </div>
                        )}

                        {state.type === 'expense' ? (
                            <div className="flex flex-col gap-2">
                                <span className={labelClass}>{t('quickAdd.categoryLabel')}</span>
                                {state.showAllCategories ? (
                                    <div className="flex flex-wrap gap-2">
                                        {catChips.map((n) => (
                                            <Chip key={n} selected={state.category === n} tone={n === suggested ? 'suggested' : 'default'} onClick={() => set({ category: n, categoryTouched: true })}>
                                                {localizeCategory(n)}
                                            </Chip>
                                        ))}
                                    </div>
                                ) : (
                                    <ChipRow>
                                        {catChips.map((n) => (
                                            <Chip key={n} selected={state.category === n} tone={n === suggested ? 'suggested' : 'default'} onClick={() => set({ category: n, categoryTouched: true })}>
                                                {localizeCategory(n)}
                                            </Chip>
                                        ))}
                                        {ranked.all.length > catChips.length ? <Chip onClick={() => set({ showAllCategories: true })}>{t('quickAdd.categoryMore')}</Chip> : null}
                                    </ChipRow>
                                )}
                            </div>
                        ) : null}

                        <ChipRow>
                            <Chip selected={state.date === today} onClick={() => set({ date: today })}>
                                {t('quickAdd.today')}
                            </Chip>
                            <Chip selected={state.date === yesterday} onClick={() => set({ date: yesterday })}>
                                {t('quickAdd.yesterday')}
                            </Chip>
                            <span className="relative inline-flex">
                                <Chip selected={customDate} icon={Calendar} onClick={() => (dateInputRef.current?.showPicker ? dateInputRef.current.showPicker() : dateInputRef.current?.focus())}>
                                    {customDate ? state.date : t('quickAdd.pick')}
                                </Chip>
                                <input
                                    ref={dateInputRef}
                                    type="date"
                                    tabIndex={-1}
                                    aria-label={t('quickAdd.pick')}
                                    value={state.date}
                                    onChange={(e) => e.target.value && set({ date: e.target.value })}
                                    className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
                                />
                            </span>
                            {!isTransfer && accounts.length > 0 ? (
                                <>
                                    <span className="mx-0.5 my-1.5 w-px shrink-0 bg-line-strong" aria-hidden="true" />
                                    {accounts.map((a) => (
                                        <Chip key={a.id} selected={state.accountId === a.id} onClick={() => set({ accountId: a.id })}>
                                            {a.name}
                                        </Chip>
                                    ))}
                                </>
                            ) : null}
                        </ChipRow>

                        <button
                            type="button"
                            aria-expanded={state.showMore}
                            onClick={() => set({ showMore: !state.showMore })}
                            className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-[14px] text-sm font-semibold text-forest-ink"
                        >
                            {t('quickAdd.more')}
                            <ChevronDown size={16} className={state.showMore ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" />
                        </button>
                        {state.showMore ? (
                            <MoreSection
                                value={state.more}
                                onChange={(more) => set({ more })}
                                groups={groups}
                                date={state.date}
                                onOpenSplit={() => setSplitOpen(true)}
                                onCreateGroup={(name) => createGroup({ name, color: '#3b82f6', isPinned: false })}
                            />
                        ) : null}
                    </div>
                </div>
                {state.showMore ? (
                    <div className="flex shrink-0 gap-2 px-5 pt-2">
                        <button
                            type="button"
                            onClick={() => set({ showMore: false })}
                            className="h-14 flex-1 rounded-2xl border border-line-strong bg-surface font-mono text-lg text-ink"
                            aria-label={t('quickAdd.editAmount')}
                            dir="ltr"
                        >
                            {amountText}
                        </button>
                        <button type="button" onClick={save} disabled={!canSave || saving} className="h-14 flex-1 rounded-2xl bg-forest text-base font-semibold text-white disabled:opacity-40">
                            {t('quickAdd.save')}
                        </button>
                    </div>
                ) : (
                <Keypad onKey={press} onSave={save} saveDisabled={!canSave || saving} saveLabel={t('quickAdd.save')} decimalLabel={sep} />
                )}
            </div>

            </Sheet>
            {splitOpen ? (
                <SplitManager
                    receipt={{ ...(editing || {}), total, currency: state.more.currency, splitData: state.more.splitData }}
                    onSave={(splitData) => {
                        set({ more: { ...state.more, splitData } });
                        setSplitOpen(false);
                    }}
                    onClose={() => setSplitOpen(false)}
                />
            ) : null}
        </>
    );
}
