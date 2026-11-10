// Canonical category names after plan phase 2 (section 4). Pure data, shared by the client
// (categorizer, import) and the server (api/_lib). UI colours/icons live in constants.js (P3-T1).
export const EXPENSE_CATEGORIES = [
    'Groceries',
    'Dining',
    'Fuel',
    'Transport',
    'Housing',
    'Utilities',
    'Subscriptions',
    'Shopping',
    'Health',
    'Personal care',
    'Entertainment',
    'Travel',
    'Education',
    'Insurance',
    'Gifts',
    'Fees',
    'Other',
];

export const FALLBACK_CATEGORY = 'Other';

/** Case-insensitive lookup; returns the canonical name or null. */
export function canonicalCategory(name, allowed = EXPENSE_CATEGORIES) {
    if (typeof name !== 'string') return null;
    const wanted = name.trim().toLowerCase();
    return allowed.find((c) => c.toLowerCase() === wanted) || null;
}
