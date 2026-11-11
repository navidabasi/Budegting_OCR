import { ChevronDown, ChevronUp, Edit2, Pin, PinOff, Tag, Trash2 } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

/** Group card (moved from ReceiptsPage). */
export default function GroupCard({ group, onClick, onEdit, onDelete, onTogglePin, isDragOver = false, isExpanded = false, onDragOver, onDragLeave, onDrop, filteredReceiptCount }) {
    const { t } = useTranslation();
    const groupColor = group.color || '#3b82f6';
    const fadedColor = groupColor + '15'; // 15% opacity
    const groupId = group.supabaseId || group.id;

    return (
        <div
            data-group-id={groupId}
            className="interactive-card"
            style={{
                backgroundColor: isDragOver ? groupColor + '30' : fadedColor,
                borderLeft: `4px solid ${groupColor}`,
                transform: isDragOver ? 'scale(1.02)' : 'scale(1)',
                boxShadow: isDragOver ? `0 4px 12px ${groupColor}40` : undefined
            }}
            onClick={onClick}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <div className="mb-2 flex flex-wrap items-start justify-between gap-1">
                <div className="min-w-0 flex-1 basis-40">
                    <div className="flex flex-wrap items-center gap-2">
                        {isExpanded ? <ChevronDown size={18} className="text-gray-500 dark:text-gray-400" /> : <ChevronUp size={18} className="text-gray-500 dark:text-gray-400" />}
                        <h3 className="min-w-0 break-words text-lg font-semibold text-gray-900 dark:text-gray-100">{group.name}</h3>
                        <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded"
                            style={{
                                backgroundColor: (group.color || '#3b82f6') + '20',
                                color: group.color || '#3b82f6',
                                border: `1px solid ${(group.color || '#3b82f6')}40`
                            }}
                        >
                            <Tag size={12} style={{ color: group.color || '#3b82f6' }} />
                            {t('receipts.groups.groupTag')}
                        </span>
                        {group.isPinned && (
                            <Pin size={14} className="text-gray-400" title={t('receipts.page.pinned')} />
                        )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {t('receipts.groups.receiptCount', {
                            count: filteredReceiptCount !== undefined ? filteredReceiptCount : (group.receiptCount || 0),
                            suffix: (filteredReceiptCount !== undefined ? filteredReceiptCount : (group.receiptCount || 0)) !== 1 ? 's' : '',
                        })}
                    </p>
                </div>
                <div className="ms-1 flex shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                        onClick={onTogglePin}
                        aria-label={group.isPinned ? t('receipts.groups.unpinGroup') : t('receipts.groups.pinGroup')}
                        className={`flex h-11 w-11 items-center justify-center rounded-lg ${group.isPinned ? 'text-red-500 hover:text-red-700' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                        title={group.isPinned ? t('receipts.groups.unpinGroup') : t('receipts.groups.pinGroup')}
                    >
                        {group.isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                    </button>
                    <button
                        onClick={onEdit}
                        aria-label={t('receipts.groups.editGroupTitle')}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        title={t('receipts.groups.editGroupTitle')}
                    >
                        <Edit2 size={16} />
                    </button>
                    <button
                        onClick={onDelete}
                        aria-label={t('receipts.groups.deleteGroupTitle')}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-red-500 hover:text-red-700"
                        title={t('receipts.groups.deleteGroupTitle')}
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
