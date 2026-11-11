import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { useCreateGroup, useDeleteGroup, useTransactions, useUpdateGroup, useUpdateTransaction } from '../data/hooks';
import { useTranslation } from '../languages/useTranslation';

/**
 * Group writes with their side effects and toasts: create, update (a rename is copied to the transactions' groupName), remove (the
 * transactions are ungrouped by the repository), assign / unassign transactions.
 */
export function useGroupActions() {
    const { t } = useTranslation();
    const showToast = useAppStore((s) => s.showToast);
    const { transactions } = useTransactions();
    const createGroup = useCreateGroup();
    const updateGroup = useUpdateGroup();
    const deleteGroup = useDeleteGroup();
    const updateTransaction = useUpdateTransaction();

    const create = useCallback(
        async (data) => {
            try {
                const g = await createGroup(data);
                showToast(t('groups.created', { name: data.name }), 'success');
                return g;
            } catch (err) {
                showToast(t('receipts.groups.failedCreate', { message: err.message }), 'error');
                throw err;
            }
        },
        [createGroup, showToast, t]
    );

    const update = useCallback(
        async (group, patch) => {
            try {
                await updateGroup(group.id, patch);
                if (patch.name && patch.name !== group.name) {
                    for (const tx of transactions.filter((r) => r.groupId === group.id)) await updateTransaction(tx.id, { groupName: patch.name });
                }
                showToast(t('receipts.groups.updateSuccess'), 'success');
            } catch (err) {
                showToast(t('receipts.groups.failedUpdate', { message: err.message }), 'error');
                throw err;
            }
        },
        [updateGroup, updateTransaction, transactions, showToast, t]
    );

    const remove = useCallback(
        async (group) => {
            try {
                await deleteGroup(group.id);
                showToast(t('receipts.groups.deleteSuccess'), 'success');
            } catch (err) {
                showToast(t('receipts.groups.failedDelete', { message: err.message }), 'error');
                throw err;
            }
        },
        [deleteGroup, showToast, t]
    );

    /** Put transactions into `group` (or take them out with group = null). */
    const assign = useCallback(
        async (ids, group) => {
            try {
                for (const id of ids) await updateTransaction(id, { groupId: group?.id || null, groupName: group?.name || null });
                showToast(group ? t('groups.added', { count: ids.length, name: group.name }) : t('groups.removed', { count: ids.length }), 'success');
            } catch {
                showToast(t('quickAdd.saveFailed'), 'error');
            }
        },
        [updateTransaction, showToast, t]
    );

    return { create, update, remove, assign };
}
