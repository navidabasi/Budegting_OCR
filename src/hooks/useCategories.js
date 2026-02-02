import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { electricStorage } from '../services/electricStorage';
import { DEFAULT_CATEGORIES } from '../utils/constants';

/**
 * Custom hook for fetching categories
 * Uses Electric + PGlite for local-first storage with real-time sync
 * @returns {Array} categories
 */
export function useCategories() {
    const currentUser = useAppStore((state) => state.currentUser);
    const [categories, setCategories] = useState(DEFAULT_CATEGORIES);

    const loadCategories = useCallback(async () => {
        if (!currentUser) {
            setCategories(DEFAULT_CATEGORIES);
            return;
        }

        try {
            const userCategories = await electricStorage.getCategories(currentUser.userId);
            if (userCategories && userCategories.length > 0) {
                // Merge user categories with defaults
                const customNames = userCategories.map(c => c.name);
                const defaultsNotOverridden = DEFAULT_CATEGORIES.filter(c => !customNames.includes(c.name));
                setCategories([...defaultsNotOverridden, ...userCategories.map(c => ({
                    name: c.name,
                    color: c.color,
                    icon: '📁'
                }))]);
            } else {
                setCategories(DEFAULT_CATEGORIES);
            }
        } catch (error) {
            console.error('Failed to load categories:', error);
            setCategories(DEFAULT_CATEGORIES);
        }
    }, [currentUser]);

    useEffect(() => {
        loadCategories();
    }, [loadCategories]);

    // Subscribe to Electric sync updates
    useEffect(() => {
        if (!currentUser) return;

        const unsubscribe = electricStorage.subscribe('user_categories', () => {
            loadCategories();
        });

        return unsubscribe;
    }, [currentUser, loadCategories]);

    return categories;
}
