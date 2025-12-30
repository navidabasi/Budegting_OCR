import { MERCHANT_CATEGORY_MAP, CATEGORIES, DEFAULT_CATEGORY } from '../utils/constants';

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

    getAllCategories() {
        return CATEGORIES;
    },

    getDefaultCategory() {
        return DEFAULT_CATEGORY;
    }
};

