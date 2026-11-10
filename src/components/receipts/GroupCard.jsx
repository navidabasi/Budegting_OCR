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
            <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        {isExpanded ? <ChevronDown size={18} className="text-gray-500 dark:text-gray-400" /> : <ChevronUp size={18} className="text-gray-500 dark:text-gray-400" />}
                        <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">{group.name}</h3>
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
                <div className="flex gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                    <button
                        onClick={onTogglePin}
                        className={`p-1.5 rounded ${group.isPinned ? 'text-red-500 hover:text-red-700' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                        title={group.isPinned ? t('receipts.groups.unpinGroup') : t('receipts.groups.pinGroup')}
                    >
                        {group.isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                    </button>
                    <button
                        onClick={onEdit}
                        className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded"
                        title={t('receipts.groups.editGroupTitle')}
                    >
                        <Edit2 size={16} />
                    </button>
                    <button
                        onClick={onDelete}
                        className="p-1.5 text-red-500 hover:text-red-700 rounded"
                        title={t('receipts.groups.deleteGroupTitle')}
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
