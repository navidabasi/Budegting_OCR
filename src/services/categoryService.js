import { MERCHANT_CATEGORY_MAP, CATEGORIES, DEFAULT_CATEGORY } from '../utils/constants';
import { listCategories } from '../data/repo';

export const categoryService = {
    suggestCategory(merchantName, itemName = '') {
        const searchText = `${merchantName} ${itemName}`.toLowerCase();

        // Check merchant name first
        for (const [keyword, category] of Object.entries(MERCHANT_CATEGORY_MAP)) {
            if (searchText.includes(keyword)) {
                return category;
            }
        }

        // Check item name for keywords
        const itemKeywords = {
            'milk': 'Groceries',
            'bread': 'Groceries',
            'eggs': 'Groceries',
            'chicken': 'Groceries',
            'beef': 'Groceries',
            'pork': 'Groceries',
            'fish': 'Groceries',
            'fruit': 'Groceries',
            'vegetable': 'Groceries',
            'coffee': 'Groceries',
            'tea': 'Groceries',
            'pasta': 'Groceries',
            'tomato': 'Groceries',
            'rice': 'Groceries',
            'flour': 'Groceries',
            'sugar': 'Groceries',
            'salt': 'Groceries',
            'pepper': 'Groceries',
            'onion': 'Groceries',
            'garlic': 'Groceries',
            'potato': 'Groceries',
            'lettuce': 'Groceries',
            'carrot': 'Groceries',
            'banana': 'Groceries',
            'apple': 'Groceries',
            'orange': 'Groceries',
            'cereal': 'Groceries',
            'yogurt': 'Groceries',
            'cheese': 'Groceries',
            'butter': 'Groceries',
            'juice': 'Groceries',
            'soda': 'Groceries',
            'water': 'Groceries',
            'pizza': 'Restaurant',
            'burger': 'Restaurant',
            'sandwich': 'Restaurant',
            'salad': 'Restaurant',
            'soup': 'Restaurant',
            'gas': 'Gas',
            'fuel': 'Gas',
            'petrol': 'Gas',
            'electric': 'Utilities',
            'internet': 'Utilities',
            'phone': 'Utilities',
            'prescription': 'Healthcare',
            'medicine': 'Healthcare',
            'vitamin': 'Healthcare',
            'uber': 'Transportation',
            'lyft': 'Transportation',
            'taxi': 'Transportation',
            'movie': 'Entertainment',
            'game': 'Entertainment',
            'subscription': 'Entertainment'
        };

        for (const [keyword, category] of Object.entries(itemKeywords)) {
            if (searchText.includes(keyword)) {
                return category;
            }
        }

        return DEFAULT_CATEGORY;
    },

    async getAllCategories(userId = null) {
        const defaultCats = [...CATEGORIES];
        
        if (userId) {
            try {
                const customCats = await listCategories(userId);
                const customNames = customCats.map(cat => cat.name);
                // Merge custom categories, avoiding duplicates
                customNames.forEach(name => {
                    if (!defaultCats.includes(name)) {
                        defaultCats.push(name);
                    }
                });
            } catch (error) {
                console.warn('Failed to load custom categories:', error);
            }
        }
        
        return defaultCats;
    },

    // Synchronous version for backward compatibility (returns only defaults)
    getAllCategoriesSync() {
        return CATEGORIES;
    },

    async getCategoryColors(userId = null) {
        const colors = {};
        
        // Default colors for default categories
        const defaultColors = [
            '#00573f', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444',
            '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
        ];
        
        CATEGORIES.forEach((cat, index) => {
            colors[cat] = defaultColors[index % defaultColors.length];
        });
        
        if (userId) {
            try {
                const customCats = await listCategories(userId);
                customCats.forEach(cat => {
                    if (cat.color) {
                        colors[cat.name] = cat.color;
                    }
                });
            } catch (error) {
                console.warn('Failed to load custom category colors:', error);
            }
        }
        
        return colors;
    },

    getDefaultCategory() {
        return DEFAULT_CATEGORY;
    }
};

