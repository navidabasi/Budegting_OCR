import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '../../utils/helpers';
import CurrencyDisplay from '../common/CurrencyDisplay';
import { Tag, Users, Pin, PinOff, RefreshCw } from 'lucide-react';

export default function ReceiptCard({ receipt, onDropOnReceipt, isNested = false, nestedGroupColor = null, onTogglePin }) {
    const navigate = useNavigate();
    const [isDragging, setIsDragging] = useState(false);
    const [touchStart, setTouchStart] = useState(null);
    const [isLongPress, setIsLongPress] = useState(false);
    const [longPressTimer, setLongPressTimer] = useState(null);
    const [isDragOver, setIsDragOver] = useState(false);

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
        const touch = e.touches[0];
        setTouchStart({
            x: touch.clientX,
            y: touch.clientY,
            time: Date.now()
        });
        setIsLongPress(false);

        // Start long-press timer — drag only activates after 500ms hold
        const timer = setTimeout(() => {
            setIsLongPress(true);
        }, 500);
        setLongPressTimer(timer);
    };

    const handleTouchMove = (e) => {
        if (!touchStart) return;
        const touch = e.touches[0];
        const deltaX = Math.abs(touch.clientX - touchStart.x);
        const deltaY = Math.abs(touch.clientY - touchStart.y);

        // Cancel long-press if finger moves before timer fires (user is scrolling)
        if (deltaX > 10 || deltaY > 10) {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                setLongPressTimer(null);
            }
        }

        // Only start drag if long-press was achieved first
        if (isLongPress && (deltaX > 10 || deltaY > 10)) {
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

        if (isDragging) {
            // Check if dropped on a group card (including nested groups and expanded group containers)
            const groupCard = elementBelow?.closest('[data-group-id]');
            if (groupCard) {
                const groupId = groupCard.getAttribute('data-group-id');
                // Check if it's an expanded container (has class with 'rounded-lg border-2')
                const isExpandedContainer = groupCard.classList.contains('rounded-lg') && 
                                           groupCard.classList.contains('border-2') &&
                                           groupCard.classList.contains('border-dashed');
                
                // Only dispatch if it's a group card or expanded container
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
                // Only navigate if not dragging
                if (!isDragging && !isDragOver) {
                    navigate(`/receipts/${receipt.id}`);
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
                <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        {onTogglePin && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTogglePin(receipt.id, receipt.isPinned);
                                }}
                                className={`p-1 rounded transition-colors ${receipt.isPinned ? 'text-red-500 hover:text-red-700' : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'}`}
                                title={receipt.isPinned ? 'Unpin receipt' : 'Pin receipt'}
                            >
                                {receipt.isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                            </button>
                        )}
                        <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">{receipt.merchant}</h3>
                        {receipt.groupName && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                                <Tag size={12} />
                                {receipt.groupName}
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{formatDate(receipt.date)}</p>
                </div>
                <div className="text-right">
                    <div className={`font-bold text-xl ${receipt.transactionType === 'income' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-gray-100'}`}>
                        <CurrencyDisplay amount={receipt.total} currency={receipt.currency} />
                    </div>
                    {receipt.category && (
                        <span className="inline-block mt-1 px-2 py-1 text-xs rounded dark:bg-primary-800 dark:text-primary-200 primary-bg primary-color">
                            {receipt.category}
                        </span>
                    )}
                </div>
            </div>
            {receipt.notes && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-1">{receipt.notes}</p>
            )}
            {receipt.lineItems && receipt.lineItems.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    {receipt.lineItems.length} item{receipt.lineItems.length !== 1 ? 's' : ''}
                </p>
            )}
            {receipt.splitData && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 flex items-center gap-1">
                    <Users size={12} />
                    Split between {receipt.splitData.people} person{receipt.splitData.people !== 1 ? 's' : ''}
                </p>
            )}
            {receipt.recurringData?.isActive && (
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-2 flex items-center gap-1">
                    <RefreshCw size={12} />
                    Recurring ({receipt.recurringData.frequency})
                </p>
            )}
        </div>
    );
}

