import { useMemo } from 'react';
import { useUserCategories } from '../data/hooks';
import { DEFAULT_CATEGORIES } from '../utils/constants';

/**
 * Default categories merged with the user's custom categories.
 * @returns {Array} categories
 */
export function useCategories() {
    const { categories: userCategories } = useUserCategories();

    return useMemo(() => {
        if (!userCategories || userCategories.length === 0) {
            return DEFAULT_CATEGORIES;
        }
        const customNames = userCategories.map((c) => c.name);
        const defaultsNotOverridden = DEFAULT_CATEGORIES.filter((c) => !customNames.includes(c.name));
        return [
            ...defaultsNotOverridden,
            ...userCategories.map((c) => ({ name: c.name, color: c.color, icon: '📁' })),
        ];
    }, [userCategories]);
}
