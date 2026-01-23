import { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { categoryService } from '../services/categoryService';

/**
 * Custom hook for fetching categories
 * @returns {Array} categories
 */
export function useCategories() {
    const currentUser = useAppStore((state) => state.currentUser);
    const [categories, setCategories] = useState([]);

    useEffect(() => {
        const loadCategories = async () => {
            if (currentUser) {
                try {
                    const cats = await categoryService.getAllCategories(currentUser.userId);
                    setCategories(cats);
                } catch (error) {
                    console.error('Failed to load categories:', error);
                    setCategories(categoryService.getAllCategoriesSync()); // Fallback
                }
            } else {
                setCategories(categoryService.getAllCategoriesSync()); // Fallback
            }
        };

        loadCategories();
    }, [currentUser]);

    return categories;
}
