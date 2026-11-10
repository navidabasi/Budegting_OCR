import { describe, it, expect } from 'vitest';
import { EXPENSE_CATEGORIES, normalizeCategoryName } from '../categoryNames';
import { categoryColor } from '../categoryColors';
import { categoryVisual } from '../categoryVisual.jsx';

describe('normalizeCategoryName (read-side v14 mapping)', () => {
    it('maps the four renamed categories', () => {
        expect(normalizeCategoryName('Restaurant')).toBe('Dining');
        expect(normalizeCategoryName('Healthcare')).toBe('Health');
        expect(normalizeCategoryName('Transportation')).toBe('Transport');
        expect(normalizeCategoryName('Gas')).toBe('Fuel');
    });
    it('leaves new names and custom categories alone', () => {
        for (const n of [...EXPENSE_CATEGORIES, 'Date', 'Debt', 'Gift', 'Stocks', 'toString']) expect(normalizeCategoryName(n)).toBe(n);
        expect(normalizeCategoryName(null)).toBe(null);
    });
});

describe('category visuals', () => {
    it('has an icon and a light + dark colour for every default category', () => {
        for (const n of EXPENSE_CATEGORIES) {
            expect(categoryVisual(n).Icon).toBeTruthy();
            expect(categoryColor(n, false)).toMatch(/^#/);
            expect(categoryColor(n, true)).not.toBe(categoryColor(n, false));
        }
    });
    it('custom categories get an icon and a stable colour', () => {
        expect(categoryVisual('Stocks').Icon).toBeTruthy();
        expect(categoryColor('Stocks')).toBe(categoryColor('Stocks'));
        expect(categoryColor('Date', false, '#123456')).toBe('#123456');
    });
});
