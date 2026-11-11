import { memo, useRef, useState } from 'react';
import { Camera, Tag, Trash2 } from 'lucide-react';
import Amount from '../ui/Amount';
import { categoryVisual } from '../../utils/categoryVisual.jsx';
import { isUncategorised, isUnpaid } from '../../utils/activityFilters';
import RecordSyncBadge from '../sync/RecordSyncBadge';
import { useTranslation } from '../../languages/useTranslation';
import { readSplit } from '../../utils/splits';
import { formatMoney, localeFor } from '../../utils/format';
import { getEffectiveAmount } from '../../utils/helpers';

const ACTION_W = 88; // px revealed by a swipe
const COMMIT = 150; // px: a long swipe commits the action
const START = 10; // px before a gesture counts as a swipe

/**
 * One transaction. Swipe left = delete (with undo), swipe right = change category (pointer events).
 * Both actions also exist as real buttons behind the row; they are focusable and slide the row open on focus.
 */
function TransactionRow({ tx, accountName, toAccountName, syncState, onOpen, onDelete, onChangeCategory }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const [offset, setOffset] = useState(0);
    const [dragging, setDragging] = useState(false);
    const gesture = useRef(null);
    const justSwiped = useRef(false);

    const type = tx.transactionType || 'expense';
    const { Icon, bg, fg } = categoryVisual(tx.category, type);
    const unpaid = isUnpaid(tx);
    const uncategorised = isUncategorised(tx);
    const pending = !!tx.extraction?.pending;

    let subtitle;
    let warn = false;
    if (pending) {
        subtitle = t('activity.waitingToRead');
        warn = true;
    } else if (type === 'transfer') {
        subtitle = [t('activity.transferLabel'), accountName ? t('activity.fromAccount', { account: accountName }) : null].filter(Boolean).join(' · ');
    } else if (unpaid) {
        const due = new Date(`${String(tx.date).slice(0, 10)}T00:00:00`);
        const dueText = Number.isNaN(due.getTime()) ? '' : new Intl.DateTimeFormat(languageCode, { day: 'numeric', month: 'short' }).format(due);
        subtitle = [localizeCategory(tx.category), t('activity.unpaid'), dueText ? t('activity.due', { date: dueText }) : null].filter(Boolean).join(' · ');
        warn = true;
    } else if (uncategorised) {
        subtitle = [t('activity.uncategorised'), accountName].filter(Boolean).join(' · ');
        warn = true;
    } else {
        subtitle = [type === 'income' ? t('quickAdd.income') : localizeCategory(tx.category), accountName].filter(Boolean).join(' · ');
    }
    const shared = readSplit(tx.splitData, tx.total);
    if (shared && type === 'expense' && !pending) subtitle = [subtitle, t('shared.yourShareShort', { amount: formatMoney(getEffectiveAmount(tx), tx.currency, localeFor(languageCode, tx.currency)) })].join(' · ');
    const title = type === 'transfer' && toAccountName ? t('quickAdd.transferTo', { account: toAccountName }) : tx.merchant || t('dashboard.topMerchants.unknown');

    const onPointerDown = (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        gesture.current = { x: e.clientX, y: e.clientY, base: offset, active: false };
    };
    const onPointerMove = (e) => {
        const g = gesture.current;
        if (!g) return;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (!g.active) {
            if (Math.abs(dx) < START || Math.abs(dx) < Math.abs(dy)) return;
            g.active = true;
            setDragging(true);
            e.currentTarget.setPointerCapture?.(e.pointerId);
        }
        setOffset(Math.max(-COMMIT - 30, Math.min(COMMIT + 30, g.base + dx)));
    };
    const finish = () => {
        const g = gesture.current;
        gesture.current = null;
        if (!g?.active) return;
        setDragging(false);
        justSwiped.current = true;
        setTimeout(() => (justSwiped.current = false), 0);
        if (offset <= -COMMIT) {
            setOffset(0);
            onDelete(tx);
        } else if (offset >= COMMIT) {
            setOffset(0);
            onChangeCategory(tx);
        } else if (offset <= -ACTION_W * 0.6) setOffset(-ACTION_W);
        else if (offset >= ACTION_W * 0.6) setOffset(ACTION_W);
        else setOffset(0);
    };

    const btn = 'flex h-full w-[88px] flex-col items-center justify-center gap-1 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-white';

    return (
        <div className="relative h-full overflow-hidden" data-testid="transaction-row">
            <div className="absolute inset-y-0 left-0 flex">
                <button type="button" className={`${btn} bg-savings`} tabIndex={0} onFocus={() => setOffset(ACTION_W)} onBlur={() => setOffset(0)} onClick={() => { setOffset(0); onChangeCategory(tx); }}>
                    <Tag size={18} aria-hidden="true" />
                    {t('activity.category')}
                </button>
            </div>
            <div className="absolute inset-y-0 right-0 flex">
                <button type="button" className={`${btn} bg-over`} tabIndex={0} onFocus={() => setOffset(-ACTION_W)} onBlur={() => setOffset(0)} onClick={() => { setOffset(0); onDelete(tx); }}>
                    <Trash2 size={18} aria-hidden="true" />
                    {t('common.actions.delete')}
                </button>
            </div>
            <div
                className="relative flex h-full items-center gap-3 border-b border-line bg-ground"
                style={{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : 'transform 180ms ease-out', touchAction: 'pan-y' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={finish}
                onPointerCancel={finish}
            >
                <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-start"
                    onClick={() => {
                        if (justSwiped.current) return;
                        if (offset !== 0) setOffset(0);
                        else onOpen(tx);
                    }}
                >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] ${bg} ${fg}`}>
                        <Icon size={18} aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px] font-medium text-ink">{title}</span>
                        <span className={`flex items-center gap-1 truncate text-xs ${warn ? 'text-warn-ink' : 'text-ink-muted'}`}>
                            <span className="truncate">{subtitle}</span>
                            {tx.imagePath ? <Camera size={12} className="shrink-0 text-ink-faint" aria-label={t('activity.hasPhoto')} /> : null}
                            {syncState ? <RecordSyncBadge state={syncState} compact /> : null}
                        </span>
                    </span>
                    <Amount
                        value={tx.total}
                        sign={type === 'income'}
                        tone={type === 'transfer' ? 'savings' : type === 'income' ? 'income' : unpaid ? 'muted' : 'default'}
                        className="shrink-0 text-[15px]"
                    />
                </button>
            </div>
        </div>
    );
}

export default memo(TransactionRow);
