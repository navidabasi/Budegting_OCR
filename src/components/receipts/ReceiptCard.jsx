import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildReturnToPath, formatDate } from '../../utils/helpers';
import CurrencyDisplay from '../common/CurrencyDisplay';
import { Tag, Users, Pin, PinOff, RefreshCw, CheckCircle2, Clock3 } from 'lucide-react';
import { getTrackingStatus } from '../../utils/tracking';
import { useMarkTransactionDone } from '../../data/hooks';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';

const RECEIPT_TAG_MAX_LENGTH = 18;

const truncateReceiptTagLabel = (label) => {
    const safeLabel = String(label || '').trim();
    if (safeLabel.length <= RECEIPT_TAG_MAX_LENGTH) {
        return safeLabel;
    }
    return `${safeLabel.slice(0, Math.max(RECEIPT_TAG_MAX_LENGTH - 3, 1))}...`;
};

export default function ReceiptCard({ receipt, onDropOnReceipt, isNested = false, nestedGroupColor = null, onTogglePin, onMarkAsDone }) {
    const { t, localizeCategory } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const showToast = useAppStore((state) => state.showToast);
    const markReceiptAsDone = useMarkTransactionDone();
    const [isDragging, setIsDragging] = useState(false);
    const [touchStart, setTouchStart] = useState(null);
    const [isLongPress, setIsLongPress] = useState(false);
    const [longPressTimer, setLongPressTimer] = useState(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isMarkingDone, setIsMarkingDone] = useState(false);
    const suppressClickRef = useRef(false);
    const dragActivatedRef = useRef(false);
    const trackingStatus = getTrackingStatus(receipt);
    const receiptTags = [];

    if (receipt.groupName) {
        receiptTags.push({
            key: 'group',
            label: truncateReceiptTagLabel(receipt.groupName),
            title: receipt.groupName,
            icon: Tag,
            className: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
        });
    }

    if (receipt.category) {
        const localizedCategory = localizeCategory(receipt.category);
        receiptTags.push({
            key: 'category',
            label: truncateReceiptTagLabel(localizedCategory),
            title: localizedCategory,
            icon: null,
            className: 'dark:bg-primary-800 dark:text-primary-200 primary-bg primary-color'
        });
    }

    if (receipt.splitData) {
        const splitLabel = t('receipts.card.splitTag', { people: receipt.splitData.people });
        receiptTags.push({
            key: 'split',
            label: truncateReceiptTagLabel(splitLabel),
            title: t('receipts.card.splitBetween', { people: receipt.splitData.people }),
            icon: Users,
            className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
        });
    }

    if (receipt.recurringData?.isActive) {
        const recurringFrequency = t(`receipts.recurring.${receipt.recurringData.frequency || 'monthly'}`);
        const recurringLabel = t('receipts.card.recurringWithFrequency', {
            frequency: recurringFrequency,
        });
        receiptTags.push({
            key: 'recurring',
            label: truncateReceiptTagLabel(recurringLabel),
            title: recurringLabel,
            icon: RefreshCw,
            className: 'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
        });

        const transactionType = receipt.transactionType === 'income' ? 'income' : 'expense';
        receiptTags.push({
            key: 'recurring-transaction-type',
            label: truncateReceiptTagLabel(
                transactionType === 'income' ? t('receipts.detail.income') : t('receipts.detail.expense')
            ),
            title: transactionType === 'income' ? t('receipts.detail.income') : t('receipts.detail.expense'),
            icon: null,
            className: transactionType === 'income'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
                : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
        });
    }

    if (trackingStatus === 'open') {
        receiptTags.push({
            key: 'tracking-open',
            label: t('receipts.card.openTag'),
            title: t('receipts.card.openTag'),
            icon: Clock3,
            className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
        });
    }

    if (trackingStatus === 'done') {
        receiptTags.push({
            key: 'tracking-done',
            label: t('receipts.card.doneTag'),
            title: t('receipts.card.doneTag'),
            icon: CheckCircle2,
            className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
        });
    }

    const handleMarkAsDone = async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (isMarkingDone || trackingStatus !== 'open') {
            return;
        }

        setIsMarkingDone(true);
        try {
            await markReceiptAsDone(receipt.id);
            if (onMarkAsDone) {
                await onMarkAsDone(receipt);
            }
            showToast(
                receipt.recurringData?.isActive
                    ? t('receipts.tracking.markRecurringSuccess')
                    : t('receipts.tracking.markSuccess'),
                'success'
            );
        } catch (err) {
            showToast(err.message || t('receipts.tracking.markFailed'), 'error');
        } finally {
            setIsMarkingDone(false);
        }
    };

    const handleDragStart = (e) => {
        e.dataTransfer.setData('application/json', JSON.stringify({
            receiptId: receipt.id,
            receiptName: receipt.merchant
        }));
        e.dataTransfer.effectAllowed = 'move';
        setIsDragging(true);
        // Add visual feedback
        e.currentTarget.style.opacity = '0.5';
    };

    const handleDragEnd = (e) => {
        setIsDragging(false);
        e.currentTarget.style.opacity = '1';
    };


    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.currentTarget.contains(e.relatedTarget)) {
            setIsDragOver(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        
        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            const draggedReceiptId = data.receiptId;
            
            // Don't create group if dropping on itself
            if (draggedReceiptId === receipt.id) {
                return;
            }
            
            // Trigger create group with both receipts
            if (onDropOnReceipt) {
                onDropOnReceipt(draggedReceiptId, receipt.id);
            }
        } catch (err) {
            console.error('Failed to parse drop data:', err);
        }
    };
    
    // Prevent default drag behavior on dragover to allow drop
    const handleDragOverPrevent = (e) => {
        if (!isDragging) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            setIsDragOver(true);
        }
    };

    // Touch handlers for mobile drag and drop
    // Requires a long-press (500ms hold) before drag activates to prevent
    // accidental group creation from normal scrolling or pull-to-refresh
    const handleTouchStart = (e) => {
        if (e.target.closest('button, a, input, select, textarea, label')) {
            return;
        }

        const touch = e.touches[0];
        const target = e.currentTarget;
        setTouchStart({
            x: touch.clientX,
            y: touch.clientY,
            time: Date.now()
        });
        setIsLongPress(false);
        dragActivatedRef.current = false;
        suppressClickRef.current = false;

        // Start long-press timer — drag only activates after 500ms hold
        const timer = setTimeout(() => {
            setIsLongPress(true);
            dragActivatedRef.current = true;
            setIsDragging(true);
            target.style.opacity = '0.5';
        }, 500);
        setLongPressTimer(timer);
    };

    const handleTouchMove = (e) => {
        if (!touchStart) return;
        const touch = e.touches[0];
        const deltaX = Math.abs(touch.clientX - touchStart.x);
        const deltaY = Math.abs(touch.clientY - touchStart.y);

        // Cancel long-press if finger moves before timer fires (user is scrolling)
        if (!isLongPress && (deltaX > 16 || deltaY > 16)) {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                setLongPressTimer(null);
            }
            setTouchStart(null);
            return;
        }

        if (isLongPress || dragActivatedRef.current) {
            // Keep drag/drop responsive on Android while finger moves.
            e.preventDefault();
            setIsDragging(true);
            e.currentTarget.style.opacity = '0.5';
        }
    };

    const handleTouchEnd = (e) => {
        // Clean up long-press timer
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            setLongPressTimer(null);
        }
        setIsLongPress(false);

        if (!touchStart) return;

        const touch = e.changedTouches[0];
        const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);

        if (dragActivatedRef.current) {
            suppressClickRef.current = true;
            // Check if dropped on a group card (including nested groups and expanded group containers)
            const groupCard = elementBelow?.closest('[data-group-id]');
            if (groupCard) {
                const groupId = groupCard.getAttribute('data-group-id');

                if (groupId) {
                    const event = new CustomEvent('receiptDrop', {
                        detail: {
                            receiptId: receipt.id,
                            groupId: groupId
                        }
                    });
                    window.dispatchEvent(event);
                }
            } else {
                // Check if dropped on another receipt card
                const receiptCard = elementBelow?.closest('[data-receipt-id]');
                if (receiptCard && receiptCard.getAttribute('data-receipt-id') !== receipt.id) {
                    const targetReceiptId = receiptCard.getAttribute('data-receipt-id');
                    const event = new CustomEvent('receiptDropOnReceipt', {
                        detail: {
                            draggedReceiptId: receipt.id,
                            targetReceiptId: targetReceiptId
                        }
                    });
                    window.dispatchEvent(event);
                }
            }
        }
        
        setIsDragging(false);
        dragActivatedRef.current = false;
        setTouchStart(null);
        e.currentTarget.style.opacity = '1';
    };

    return (
        <div
            data-receipt-id={receipt.id}
            draggable={true}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOverPrevent}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onClick={() => {
                if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                }
                // Only navigate if not dragging
                if (!isDragging && !isDragOver) {
                    navigate(`/receipts/${receipt.id}`, {
                        state: {
                            returnTo: buildReturnToPath(location),
                            initialReceipt: receipt
                        }
                    });
                }
            }}
            className={`interactive-card ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''} ${isNested ? 'nested-receipt' : ''}`}
            style={{ 
                backgroundColor: isNested && nestedGroupColor ? `${nestedGroupColor}08` : undefined,
                border: isNested && nestedGroupColor ? `2px solid ${nestedGroupColor}40` : undefined,
                borderLeft: isNested && nestedGroupColor ? `4px solid ${nestedGroupColor}` : undefined,
                marginLeft: isNested ? '0.5rem' : undefined
            }}
        >
                <div className="flex items-start justify-between gap-3 mb-1">
                <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                        {onTogglePin && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTogglePin(receipt.id, receipt.isPinned);
                                }}
                                className={`p-1 rounded transition-colors ${receipt.isPinned ? 'text-red-500 hover:text-red-700' : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'}`}
                                title={receipt.isPinned ? t('receipts.card.unpinTitle') : t('receipts.card.pinTitle')}
                            >
                                {receipt.isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                            </button>
                        )}
                        <h3 className="font-semibold text-lg leading-tight text-gray-900 dark:text-gray-100 break-words">
                            {receipt.merchant}
                        </h3>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{formatDate(receipt.date)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                    <div className={`font-bold text-xl ${receipt.transactionType === 'income' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-gray-100'}`}>
                        <CurrencyDisplay amount={receipt.total} currency={receipt.currency} amountBase={receipt.amountBase} baseCurrency={receipt.baseCurrency} />
                    </div>
                </div>
            </div>
            {receiptTags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                    {receiptTags.map((tag) => {
                        const Icon = tag.icon;
                        return (
                            <span
                                key={tag.key}
                                title={tag.title}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded ${tag.className}`}
                            >
                                {Icon && <Icon size={12} className="flex-shrink-0" />}
                                <span>{tag.label}</span>
                            </span>
                        );
                    })}
                </div>
            )}
            {receipt.notes && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-1">{receipt.notes}</p>
            )}
            {receipt.lineItems && receipt.lineItems.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    {t('receipts.card.lineItemsCount', {
                        count: receipt.lineItems.length,
                        suffix: receipt.lineItems.length !== 1 ? 's' : '',
                    })}
                </p>
            )}
            {trackingStatus === 'open' && (
                <button
                    type="button"
                    onClick={handleMarkAsDone}
                    disabled={isMarkingDone}
                    className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <CheckCircle2 size={16} />
                    {isMarkingDone ? t('receipts.card.marking') : t('receipts.card.markAsDone')}
                </button>
            )}
        </div>
    );
}
