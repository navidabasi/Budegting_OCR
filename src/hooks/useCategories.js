import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { electricStorage } from '../services/electricStorage';
import { DEFAULT_CATEGORIES } from '../utils/constants';
import { tForLanguage } from '../languages';

/**
 * Custom hook for fetching categories
 * Uses Electric + PGlite for local-first storage with real-time sync
 * @returns {Array} categories
 */
export function useCategories() {
    const currentUser = useAppStore((state) => state.currentUser);
    const languageCode = useAppStore((state) => state.languageCode);
    const showToast = useAppStore((state) => state.showToast);
    const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
    const loadingRef = useRef(false);
    const offlineWarningShownRef = useRef(false);

    const loadCategories = useCallback(async () => {
        if (!currentUser) {
            setCategories(DEFAULT_CATEGORIES);
            return;
        }

        // Prevent concurrent loads
        if (loadingRef.current) return;
        loadingRef.current = true;

        try {
            // Add timeout to prevent hanging indefinitely
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Load categories timed out')), 15000)
            );

            const userCategories = await Promise.race([
                electricStorage.getCategories(currentUser.userId),
                timeoutPromise
            ]);

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
            if (error.message?.includes('Local cache unavailable while offline') && !offlineWarningShownRef.current) {
                showToast(tForLanguage(languageCode, 'errors.offlineCategoriesUnavailable'), 'warning');
                offlineWarningShownRef.current = true;
            }

            if (!error.message?.includes('Local cache unavailable while offline')) {
                offlineWarningShownRef.current = false;
            }
            setCategories(DEFAULT_CATEGORIES);
        } finally {
            loadingRef.current = false;
        }
    }, [currentUser, showToast, languageCode]);

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
