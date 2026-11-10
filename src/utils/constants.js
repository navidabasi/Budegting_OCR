import { EXPENSE_CATEGORIES } from './categoryNames';
import { categoryColor } from './categoryColors';

/** Default expense categories (plan section 4): { name, color } with the light-mode colour. */
export const DEFAULT_CATEGORIES = EXPENSE_CATEGORIES.map((name) => ({ name, color: categoryColor(name) }));
export const CATEGORIES = EXPENSE_CATEGORIES;

export const DEFAULT_CATEGORY = 'Other';

export const DEFAULT_CURRENCY = 'EUR';

export const CURRENCIES = [
    { code: 'EUR', symbol: '€', name: 'Euro' },
    { code: 'USD', symbol: '$', name: 'US Dollar' },
    { code: 'GBP', symbol: '£', name: 'British Pound' },
    { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
    { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
    { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
    { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
    { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
    { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc' },
];
