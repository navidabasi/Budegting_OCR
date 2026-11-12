import { describe, it, expect } from 'vitest';
import { collectNumbers, figuresNotIn } from '../numberGuard';

describe('number guard', () => {
    const known = collectNumbers({ a: 79, b: [12.99, { c: 1250.5 }], d: 'from 2026-10-27, about 367% more', e: 17 });
    it('collects numbers from values and from text', () => {
        for (const n of [79, 12.99, 13, 1250.5, 1251, 367, 27, 17]) expect(known.has(n)).toBe(true);
        expect(collectNumbers({ d: '367%' }, { strings: false }).size).toBe(0);
    });
    it('accepts figures that exist, in any common notation', () => {
        expect(figuresNotIn('€79 above, 12,99 a month, 1.250,50 a year, 1,250.50, 1 250,50, 367% and 2026', known)).toEqual([]);
        expect(figuresNotIn('۷۹ یورو و ١٢٫٩٩', known, { minInteger: 10 })).toEqual([]);
    });
    it('reports invented figures', () => {
        expect(figuresNotIn('You could save €85 a month, or 1.020 a year, and 12.49 on Netflix', known, { minInteger: 10 })).toEqual(['85', '1.020', '12.49']);
    });
    it('small whole numbers are only checked from the chosen floor', () => {
        expect(figuresNotIn('3 visits and 45 days', known)).toEqual([]);
        expect(figuresNotIn('3 visits and 45 days', known, { minInteger: 10 })).toEqual(['45']);
    });
});
