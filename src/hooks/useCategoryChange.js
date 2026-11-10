import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from '../languages/useTranslation';
import { applyCategoryToMatches, onCategoryChanged } from '../services/categoryLearning';
import { notifyDataChanged } from '../data/queryClient';

/**
 * changeCategory(transaction, category): saves the change, learns the merchant rule and, when other
 * transactions from the same merchant exist, offers "Apply to all N from Lidl?" in an action toast
 * (one batch write, with undo).
 */
export function useCategoryChange() {
    const { t, localizeCategory } = useTranslation();
    const showToast = useAppStore((s) => s.showToast);

    return useCallback(
        async (transaction, category) => {
            const result = await onCategoryChanged(transaction, category);
            notifyDataChanged();
            const count = result.matches.length;
            if (count === 0) {
                showToast(t('activity.categoryChanged', { category: localizeCategory(category) }), 'success');
                return result;
            }
            showToast(t('learning.applyToAll', { count, merchant: result.name }), 'info', {
                duration: 9000,
                action: {
                    label: t('learning.apply'),
                    onClick: async () => {
                        try {
                            const applied = await applyCategoryToMatches(result.matches, category);
                            notifyDataChanged();
                            showToast(t('learning.applied', { count: applied.count, category: localizeCategory(category) }), 'success', {
                                action: {
                                    label: t('quickAdd.undo'),
                                    onClick: () => applied.undo().then(() => notifyDataChanged()),
                                },
                            });
                        } catch {
                            showToast(t('quickAdd.saveFailed'), 'error');
                        }
                    },
                },
            });
            return result;
        },
        [showToast, t, localizeCategory]
    );
}
