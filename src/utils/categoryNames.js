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

/** Pre-v14 names. Rows that were mirrored before the category rename migration still carry them. */
export const LEGACY_CATEGORY_MAP = Object.freeze({ Restaurant: 'Dining', Healthcare: 'Health', Transportation: 'Transport', Gas: 'Fuel' });

/** Read-side mapping old -> new name; any other name (including custom categories) is returned unchanged. */
export const normalizeCategoryName = (name) => (typeof name === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_MAP, name) ? LEGACY_CATEGORY_MAP[name] : name);

/** Case-insensitive lookup; returns the canonical name or null. */
export function canonicalCategory(name, allowed = EXPENSE_CATEGORIES) {
    if (typeof name !== 'string') return null;
    const wanted = name.trim().toLowerCase();
    return allowed.find((c) => c.toLowerCase() === wanted) || null;
}

// ---------------------------------------------------------------------------
// Item subcategories (pass 2, section 3). A receipt item has a category (one of the categories above) and optionally a
// subcategory scoped to it. Groceries ships with a default list; the user can add their own (stored in the synced
// layout prefs as { [category]: string[] }) and edit what each item uses. Keys are stable ASCII slugs, labels are i18n.
// ---------------------------------------------------------------------------
export const GROCERY_SUBCATEGORIES = ['produce', 'dairy', 'meat_fish', 'pantry', 'snacks', 'beverages', 'frozen', 'bakery', 'other'];

export const DEFAULT_SUBCATEGORIES = Object.freeze({ Groceries: GROCERY_SUBCATEGORIES });

/** Subcategory keys offered for a category: defaults plus the user's own (deduplicated, defaults first). */
export function subcategoriesFor(category, custom = {}) {
    const base = DEFAULT_SUBCATEGORIES[category] || [];
    const extra = Array.isArray(custom?.[category]) ? custom[category] : [];
    return [...new Set([...base, ...extra.filter((s) => typeof s === 'string' && s.trim())])];
}

/** Slug for a user-typed subcategory name ("Pet food" -> "pet_food"); empty when nothing usable is left. */
export const slugSubcategory = (text) =>
    String(text || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);

/** Canonical key for a model-returned subcategory (case/space tolerant), or null when it is not an allowed key for the category. */
export function canonicalSubcategory(value, category = 'Groceries', custom = {}) {
    if (typeof value !== 'string') return null;
    const wanted = slugSubcategory(value.replace('/', '_'));
    return subcategoriesFor(category, custom).find((s) => s === wanted) || null;
}
