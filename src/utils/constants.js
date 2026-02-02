export const CATEGORIES = [
    'Groceries',
    'Restaurant',
    'Gas',
    'Utilities',
    'Shopping',
    'Entertainment',
    'Healthcare',
    'Transportation',
    'Education',
    'Other'
];

export const DEFAULT_CATEGORIES = [
    { name: 'Groceries', color: '#22c55e', icon: '🛒' },
    { name: 'Restaurant', color: '#f97316', icon: '🍽️' },
    { name: 'Gas', color: '#ef4444', icon: '⛽' },
    { name: 'Utilities', color: '#3b82f6', icon: '💡' },
    { name: 'Shopping', color: '#a855f7', icon: '🛍️' },
    { name: 'Entertainment', color: '#ec4899', icon: '🎬' },
    { name: 'Healthcare', color: '#14b8a6', icon: '🏥' },
    { name: 'Transportation', color: '#6366f1', icon: '🚗' },
    { name: 'Education', color: '#f59e0b', icon: '📚' },
    { name: 'Other', color: '#6b7280', icon: '📁' },
];

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

export const MERCHANT_CATEGORY_MAP = {
    'walmart': 'Groceries',
    'target': 'Shopping',
    'kroger': 'Groceries',
    'safeway': 'Groceries',
    'whole foods': 'Groceries',
    'costco': 'Groceries',
    'mcdonald': 'Restaurant',
    'starbucks': 'Restaurant',
    'subway': 'Restaurant',
    'pizza': 'Restaurant',
    'burger': 'Restaurant',
    'shell': 'Gas',
    'chevron': 'Gas',
    'exxon': 'Gas',
    'bp': 'Gas',
    'mobil': 'Gas',
    'amazon': 'Shopping',
    'best buy': 'Shopping',
    'home depot': 'Shopping',
    'lowes': 'Shopping',
    'netflix': 'Entertainment',
    'spotify': 'Entertainment',
    'hulu': 'Entertainment',
    'disney': 'Entertainment',
    'electric': 'Utilities',
    'water': 'Utilities',
    'gas company': 'Utilities',
    'internet': 'Utilities',
    'phone': 'Utilities',
    'cvs': 'Healthcare',
    'walgreens': 'Healthcare',
    'pharmacy': 'Healthcare',
    'hospital': 'Healthcare',
    'uber': 'Transportation',
    'lyft': 'Transportation',
    'taxi': 'Transportation',
    'train': 'Transportation',
    'bus': 'Transportation',
    'school': 'Education',
    'university': 'Education',
    'college': 'Education'
};

