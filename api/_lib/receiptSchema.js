// Output contract of /api/extract-receipt (plan P2-T3) + derived confidence rules.
import { z } from 'zod';
import { EXPENSE_CATEGORIES, FALLBACK_CATEGORY, canonicalCategory, canonicalSubcategory } from '../../src/utils/categoryNames.js';

/** "23,47" / "1.234,56" / "€ 5.00" -> number; passes numbers through; anything else -> null. */
export function toNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    let s = v.replace(/[^\d.,-]/g, '');
    if (!/\d/.test(s)) return null;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
        s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma > -1) {
        s = /,\d{3}$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
    }
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : null;
}

const num = z.preprocess((v) => toNumber(v), z.number().finite().nullable());
const numOr = (fallback) => z.preprocess((v) => toNumber(v) ?? fallback, z.number().finite());
const str = z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim() : null), z.string().nullable());
const unit = z.preprocess((v) => {
    const n = toNumber(v);
    return n === null ? 0 : Math.min(1, Math.max(0, n));
}, z.number());

// Units a receipt prints next to a quantity or unit price; anything else is dropped (never guessed).
const UNITS = ['kg', 'g', 'l', 'ml', 'cl', 'pc'];
const UNIT_ALIASES = { kgs: 'kg', gr: 'g', grammi: 'g', lt: 'l', litri: 'l', litro: 'l', pz: 'pc', pcs: 'pc', piece: 'pc', pieces: 'pc', pezzi: 'pc' };
const unitName = z.preprocess((v) => {
    if (typeof v !== 'string') return null;
    const u = v.trim().toLowerCase().replace(/\.$/, '');
    const mapped = UNIT_ALIASES[u] || u;
    return UNITS.includes(mapped) ? mapped : null;
}, z.string().nullable());

const itemSchema = z.object({
    rawText: str.optional().default(null),
    name: z.string().trim().min(1),
    quantity: numOr(1),
    unit: unitName.optional().default(null),
    packSize: z.preprocess((v) => (typeof v === 'number' ? String(v) : typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null), z.string().nullable()).optional().default(null),
    unitPrice: num.optional().default(null),
    price: numOr(0),
    discount: num.optional().default(null),
    taxRate: num.optional().default(null),
    category: str.optional().default(null),
    subcategory: str.optional().default(null),
});

export const receiptSchema = z.object({
    merchant: str,
    merchantRaw: str.optional().default(null),
    date: str,
    time: str.optional().default(null),
    total: num,
    currency: z.preprocess((v) => (typeof v === 'string' && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : null), z.string().nullable()),
    paymentMethod: z.preprocess((v) => (['card', 'cash'].includes(String(v).toLowerCase()) ? String(v).toLowerCase() : 'unknown'), z.enum(['card', 'cash', 'unknown'])),
    category: str.optional().default(null),
    items: z.preprocess(
        (v) => (Array.isArray(v) ? v.filter((it) => it && typeof it.name === 'string' && it.name.trim()) : []),
        z.array(itemSchema)
    ),
    tax: num.optional().default(null),
    confidence: z
        .object({
            merchant: unit.optional().default(0),
            date: unit.optional().default(0),
            total: unit.optional().default(0),
            items: unit.optional().default(0),
        })
        .optional()
        .default({ merchant: 0, date: 0, total: 0, items: 0 }),
    notes: str.optional().default(null),
});

const isRealIsoDate = (s) => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Derived confidence (plan P2-T3):
 *  - total <= 0.5 when |sum(items) - total| > 2 % of total
 *  - date = 0 when in the future or more than 2 years old (or not a valid ISO date)
 * Also: a missing merchant or total has confidence 0. Returns a new confidence object.
 */
export function deriveConfidence(receipt, { today = new Date() } = {}) {
    const c = { merchant: 0, date: 0, total: 0, items: 0, ...(receipt.confidence || {}) };
    const clamp = (n) => Math.min(1, Math.max(0, Number(n) || 0));
    const out = { merchant: clamp(c.merchant), date: clamp(c.date), total: clamp(c.total), items: clamp(c.items) };

    if (!receipt.merchant) out.merchant = 0;

    if (receipt.total === null || receipt.total === undefined || !(receipt.total > 0)) {
        out.total = 0;
    } else if (Array.isArray(receipt.items) && receipt.items.length > 0) {
        const sum = receipt.items.reduce((s, it) => s + (Number(it.price) || 0), 0);
        if (sum > 0 && Math.abs(sum - receipt.total) > 0.02 * receipt.total) out.total = Math.min(out.total, 0.5);
    }

    if (!isRealIsoDate(receipt.date)) {
        out.date = 0;
    } else {
        const d = new Date(`${receipt.date}T00:00:00Z`);
        const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
        const twoYearsAgo = Date.UTC(today.getFullYear() - 2, today.getMonth(), today.getDate());
        if (d.getTime() > todayMs || d.getTime() < twoYearsAgo) out.date = 0;
    }

    if (!receipt.items || receipt.items.length === 0) out.items = 0;
    return out;
}

/**
 * Validate raw model output and normalise it: canonical categories (restricted to
 * `categories`), default currency, derived confidence, rounded money.
 * Throws a ZodError when the shape is unusable.
 */
export function normalizeReceipt(raw, { categories = EXPENSE_CATEGORIES, defaultCurrency = 'EUR', today = new Date() } = {}) {
    const parsed = receiptSchema.parse(raw);
    const pickCategory = (c) => canonicalCategory(c, categories) || (c ? FALLBACK_CATEGORY : null);
    const receiptCategory = pickCategory(parsed.category);
    const receipt = {
        ...parsed,
        date: isRealIsoDate(parsed.date) ? parsed.date : null,
        currency: parsed.currency || defaultCurrency || 'EUR',
        total: parsed.total === null ? null : round2(parsed.total),
        tax: parsed.tax === null ? null : round2(parsed.tax),
        category: pickCategory(parsed.category),
        items: parsed.items.map((it) => {
            const category = pickCategory(it.category);
            return {
                ...it,
                price: round2(it.price),
                unitPrice: it.unitPrice === null ? null : round2(it.unitPrice),
                discount: it.discount === null ? null : round2(Math.abs(it.discount)), // printed discounts are positive amounts taken off the line
                taxRate: it.taxRate === null || it.taxRate < 0 || it.taxRate > 100 ? null : it.taxRate,
                category,
                // subcategories exist for groceries only; anything the model returns outside the allowed list is dropped, not mapped
                subcategory: canonicalSubcategory(it.subcategory, category || receiptCategory) || null,
            };
        }),
    };
    receipt.confidence = deriveConfidence(receipt, { today });
    return receipt;
}
