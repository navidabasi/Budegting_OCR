import { useMemo } from 'react';
import { useUserCategories } from '../data/hooks';
import { DEFAULT_CATEGORIES } from '../utils/constants';

/**
 * Default categories merged with the user's custom categories ({ name, color }).
 * Custom names that equal a default only override its colour.
 */
export function useCategories() {
    const { categories: userCategories } = useUserCategories();

    return useMemo(() => {
        if (!userCategories || userCategories.length === 0) return DEFAULT_CATEGORIES;
        const custom = new Map(userCategories.map((c) => [c.name, c]));
        const defaults = DEFAULT_CATEGORIES.map((c) => (custom.get(c.name)?.color ? { ...c, color: custom.get(c.name).color } : c));
        const extra = userCategories.filter((c) => !DEFAULT_CATEGORIES.some((d) => d.name === c.name)).map((c) => ({ name: c.name, color: c.color }));
        return [...defaults, ...extra];
    }, [userCategories]);
}
