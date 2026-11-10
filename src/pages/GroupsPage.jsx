import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Plus, X } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useCreateGroup, useDeleteGroup, useGroupsData, useTransactions, useUpdateGroup, useUpdateTransaction } from '../data/hooks';
import GroupCard from '../components/receipts/GroupCard';
import ReceiptCard from '../components/receipts/ReceiptCard';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import EmptyState from '../components/common/EmptyState';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { compareDateValuesDesc } from '../utils/helpers';
import { useTranslation } from '../languages/useTranslation';

/** Groups management (moved out of the receipts list): create, edit, pin, delete, and see a group's transactions. */
export default function GroupsPage() {
    const { t } = useTranslation();
    const currentUser = useAppStore((state) => state.currentUser);
    const showToast = useAppStore((state) => state.showToast);
    const { groups: allGroups, loading: groupsLoading } = useGroupsData();
    const { transactions: receipts, loading: receiptsLoading } = useTransactions();
    const createGroup = useCreateGroup();
    const updateGroup = useUpdateGroup();
    const deleteGroup = useDeleteGroup();
    const updateReceipt = useUpdateTransaction();
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupColor, setNewGroupColor] = useState('#3b82f6');
    const [newGroupPinned, setNewGroupPinned] = useState(false);
    const [editingGroup, setEditingGroup] = useState(null);
    const [expandedGroups, setExpandedGroups] = useState(new Set());
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [groupToDelete, setGroupToDelete] = useState(null);

    const groups = useMemo(
        () =>
            allGroups.map((group) => {
                const groupReceipts = receipts.filter((r) => r.groupId && String(r.groupId) === String(group.id));
                return { ...group, receiptCount: groupReceipts.length, receipts: groupReceipts };
            }),
        [allGroups, receipts]
    );

    if (groupsLoading || receiptsLoading) return <LoadingSpinner className="pb-20" />;

    return (
        <main className="px-4 pb-32 pt-4">
            <div className="mb-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                    <Link to="/activity" aria-label={t('common.actions.back')} className="flex h-11 w-11 items-center justify-center rounded-full text-ink">
                        <ChevronLeft size={22} aria-hidden="true" />
                    </Link>
                    <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">{t('receipts.page.groups')}</h1>
                </div>
                <Button variant="primary" onClick={() => setShowCreateGroup(true)} className="flex min-h-[44px] items-center gap-1">
                    <Plus size={16} aria-hidden="true" />
                    {t('receipts.page.newGroup')}
                </Button>
            </div>

            {groups.length === 0 ? (
                <EmptyState message={t('groups.empty')} />
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {groups.map((group) => {
                        const id = String(group.id);
                        const isExpanded = expandedGroups.has(id);
                        return (
                            <div key={group.id} className="flex flex-col gap-2">
                                <GroupCard
                                    group={group}
                                    isExpanded={isExpanded}
                                    onClick={() =>
                                        setExpandedGroups((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(id)) next.delete(id);
                                            else next.add(id);
                                            return next;
                                        })
                                    }
                                    onEdit={() => {
                                        setEditingGroup(group);
                                        setNewGroupName(group.name);
                                        setNewGroupColor(group.color || '#3b82f6');
                                        setNewGroupPinned(group.isPinned);
                                    }}
                                    onDelete={() => {
                                        setGroupToDelete(group);
                                        setShowDeleteConfirm(true);
                                    }}
                                    onTogglePin={async () => {
                                        try {
                                            await updateGroup(group.id, { isPinned: !group.isPinned });
                                            showToast(group.isPinned ? t('receipts.groups.unpinGroup') : t('receipts.groups.pinGroup'), 'success');
                                        } catch (err) {
                                            showToast(t('receipts.toasts.pinFailed', { action: group.isPinned ? t('receipts.toasts.unpinAction') : t('receipts.toasts.pinAction'), message: err.message }), 'error');
                                        }
                                    }}
                                />
                                {isExpanded
                                    ? [...group.receipts]
                                          .sort((a, b) => compareDateValuesDesc(a.date, b.date))
                                          .map((receipt) => <ReceiptCard key={receipt.id} receipt={receipt} />)
                                    : null}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Create Group Modal */}
            {showCreateGroup && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="card max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-semibold dark:text-white">{t('receipts.groups.createGroup')}</h4>
                            <button
                                onClick={() => {
                                    setShowCreateGroup(false);
                                    setNewGroupName('');
                                    setNewGroupColor('#3b82f6');
                                    setNewGroupPinned(false);
                                }}
                                className="text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <Input
                                label={t('receipts.groups.groupName')}
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                placeholder={t('receipts.groups.groupNamePlaceholder')}
                            />
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-white mb-2">
                                    {t('receipts.groups.groupColor')}
                                </label>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#f97316', '#ec4899', '#14b8a6', '#6b7280', '#6366f1'].map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            onClick={() => setNewGroupColor(color)}
                                            className={`w-10 h-10 rounded-lg border-2 transition-all ${newGroupColor === color
                                                ? 'border-gray-900 dark:border-gray-100 scale-110'
                                                : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                                                }`}
                                            style={{ backgroundColor: color }}
                                        />
                                    ))}
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={newGroupColor}
                                        onChange={(e) => setNewGroupColor(e.target.value)}
                                        className="w-12 h-10 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                                    />
                                    <input
                                        type="text"
                                        value={newGroupColor}
                                        onChange={(e) => setNewGroupColor(e.target.value)}
                                        placeholder="#3b82f6"
                                        className="flex-1 input text-sm font-mono"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="pinGroup"
                                    checked={newGroupPinned}
                                    onChange={(e) => setNewGroupPinned(e.target.checked)}
                                    className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                                />
                                <label htmlFor="pinGroup" className="text-sm text-gray-700 dark:text-gray-300">
                                    {t('receipts.groups.pinTop')}
                                </label>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="primary"
                                    onClick={async () => {
                                        if (!newGroupName.trim()) {
                                            showToast(t('receipts.groups.nameRequired'), 'error');
                                            return;
                                        }
                                        if (!currentUser) return;
                                        try {
                                            await createGroup({
                                                name: newGroupName.trim(),
                                                color: newGroupColor,
                                                isPinned: newGroupPinned
                                            });
                                            setShowCreateGroup(false);
                                            setNewGroupName('');
                                            setNewGroupColor('#3b82f6');
                                            setNewGroupPinned(false);
                                            showToast(t('receipts.groups.createSuccess'), 'success');
                                        } catch (err) {
                                            showToast(t('receipts.groups.failedCreate', { message: err.message }), 'error');
                                        }
                                    }}
                                    className="flex-1"
                                >
                                    {t('common.actions.create')}
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        setShowCreateGroup(false);
                                        setNewGroupName('');
                                        setNewGroupColor('#3b82f6');
                                        setNewGroupPinned(false);
                                    }}
                                >
                                    {t('common.actions.cancel')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Group Modal */}
            {editingGroup && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="card max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-semibold dark:text-white">{t('receipts.groups.editGroup')}</h4>
                            <button
                                onClick={() => {
                                    setEditingGroup(null);
                                    setNewGroupName('');
                                    setNewGroupColor('#3b82f6');
                                    setNewGroupPinned(false);
                                }}
                                className="text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <Input
                                label={t('receipts.groups.groupName')}
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                            />
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-white mb-2">
                                    {t('receipts.groups.groupColor')}
                                </label>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#f97316', '#ec4899', '#14b8a6', '#6b7280', '#6366f1'].map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            onClick={() => setNewGroupColor(color)}
                                            className={`w-10 h-10 rounded-lg border-2 transition-all ${newGroupColor === color
                                                ? 'border-gray-900 dark:border-gray-100 scale-110'
                                                : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                                                }`}
                                            style={{ backgroundColor: color }}
                                        />
                                    ))}
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={newGroupColor}
                                        onChange={(e) => setNewGroupColor(e.target.value)}
                                        className="w-12 h-10 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                                    />
                                    <input
                                        type="text"
                                        value={newGroupColor}
                                        onChange={(e) => setNewGroupColor(e.target.value)}
                                        placeholder="#3b82f6"
                                        className="flex-1 input text-sm font-mono"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="pinGroupEdit"
                                    checked={newGroupPinned}
                                    onChange={(e) => setNewGroupPinned(e.target.checked)}
                                    className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                                />
                                <label htmlFor="pinGroupEdit" className="text-sm text-gray-700 dark:text-gray-300">
                                    {t('receipts.groups.pinTop')}
                                </label>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="primary"
                                    onClick={async () => {
                                        try {
                                            const oldName = editingGroup.name;
                                            await updateGroup(editingGroup.id, {
                                                name: newGroupName.trim(),
                                                color: newGroupColor,
                                                isPinned: newGroupPinned
                                            });

                                            // Update groupName in all receipts if name changed
                                            if (oldName !== newGroupName.trim()) {
                                                const groupIdToMatch = String(editingGroup.supabaseId || editingGroup.id);
                                                const receiptsToUpdate = receipts.filter(r => {
                                                    if (!r.groupId) return false;
                                                    return String(r.groupId) === groupIdToMatch;
                                                });

                                                for (const receipt of receiptsToUpdate) {
                                                    await updateReceipt(receipt.id, {
                                                        groupName: newGroupName.trim()
                                                    });
                                                }
                                            }
                                            setEditingGroup(null);
                                            setNewGroupName('');
                                            setNewGroupColor('#3b82f6');
                                            setNewGroupPinned(false);
                                            showToast(t('receipts.groups.updateSuccess'), 'success');
                                        } catch (err) {
                                            showToast(t('receipts.groups.failedUpdate', { message: err.message }), 'error');
                                        }
                                    }}
                                    className="flex-1"
                                >
                                    {t('common.actions.update')}
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        setEditingGroup(null);
                                        setNewGroupName('');
                                        setNewGroupColor('#3b82f6');
                                        setNewGroupPinned(false);
                                    }}
                                >
                                    {t('common.actions.cancel')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="card max-w-md w-full">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-semibold dark:text-white">{t('receipts.groups.deleteGroup')}</h4>
                            <button
                                onClick={() => {
                                    setShowDeleteConfirm(false);
                                    setGroupToDelete(null);
                                }}
                                className="text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <p className="text-gray-700 dark:text-gray-300 mb-6">
                            {t('receipts.groups.deleteMessage')}
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setShowDeleteConfirm(false);
                                    setGroupToDelete(null);
                                }}
                                className="flex-1"
                            >
                                {t('common.actions.cancel')}
                            </Button>
                            <Button
                                variant="primary"
                                onClick={async () => {
                                    if (!groupToDelete) return;
                                    try {
                                        await deleteGroup(groupToDelete.id);
                                        showToast(t('receipts.groups.deleteSuccess'), 'success');
                                        setShowDeleteConfirm(false);
                                        setGroupToDelete(null);
                                    } catch (err) {
                                        showToast(t('receipts.groups.failedDelete', { message: err.message }), 'error');
                                    }
                                }}
                                className="flex-1 bg-red-600 hover:bg-red-700"
                            >
                                {t('common.actions.delete')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
