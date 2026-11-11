import { describe, expect, it } from 'vitest';
import { markEdited, mergeExtraction, userEditedFields } from '../extractionMerge';
import { findManualMatches } from '../scanMatch';

describe('extractionMerge', () => {
    const placeholder = { merchant: 'Receipt to read', total: 0, currency: 'EUR', category: 'Other', date: '2026-11-09', lineItems: [], extraction: { pending: true } };

    it('fills every field of an untouched placeholder', () => {
        const { patch, kept } = mergeExtraction(placeholder, { merchant: 'Lidl', total: 23.47, date: '2026-11-08', category: 'Groceries', lineItems: [{ name: 'Latte', price: 1.19 }] }, { provider: 'vision' });
        expect(kept).toEqual([]);
        expect(patch).toMatchObject({ merchant: 'Lidl', total: 23.47, date: '2026-11-08', category: 'Groceries' });
        expect(patch.extraction).toMatchObject({ provider: 'vision', pending: false, needsReview: true });
    });

    it('never replaces a field the user edited; keeps the reading as a suggestion', () => {
        const edited = { ...placeholder, total: 20, extraction: { pending: true, editedAt: { total: '2026-11-09T10:00:00Z' } } };
        const { patch, kept } = mergeExtraction(edited, { merchant: 'Lidl', total: 23.47 }, {});
        expect(kept).toEqual(['total']);
        expect(patch.total).toBeUndefined();
        expect(patch.merchant).toBe('Lidl');
        expect(patch.extraction.suggested).toEqual({ total: 23.47 });
        expect(patch.extraction.editedAt).toEqual({ total: '2026-11-09T10:00:00Z' });
    });

    it('treats every filled field of a manual entry (no extraction) as the user\'s', () => {
        const manual = { merchant: 'Lidl', total: 23.47, currency: 'EUR', category: 'Groceries', date: '2026-11-08', lineItems: [] };
        expect([...userEditedFields(manual)].sort()).toEqual(['category', 'currency', 'date', 'merchant', 'total']);
        const { patch } = mergeExtraction(manual, { merchant: 'LIDL ITALIA', total: 99, lineItems: [{ name: 'x', price: 1 }] }, {});
        expect(patch.merchant).toBeUndefined();
        expect(patch.total).toBeUndefined();
        expect(patch.lineItems).toHaveLength(1); // empty items are free to fill
    });

    it('markEdited records per-field times only for scan-origin records and real changes', () => {
        expect(markEdited({ merchant: 'A' }, { merchant: 'B' })).toBeNull(); // manual record: nothing to track
        const ex = markEdited(placeholder, { total: 5, merchant: 'Receipt to read' }, '2026-11-09T10:00:00Z');
        expect(ex.editedAt).toEqual({ total: '2026-11-09T10:00:00Z' });
        expect(markEdited(placeholder, { total: 0 })).toBeNull();
    });
});

describe('findManualMatches (brief case 2)', () => {
    const txs = [
        { id: 'a', merchant: 'Lidl', total: 23.47, currency: 'EUR', date: '2026-11-08', transactionType: 'expense' },
        { id: 'b', merchant: 'Coffee', total: 23.47, currency: 'EUR', date: '2026-11-08', transactionType: 'expense' },
        { id: 'c', merchant: 'Lidl', total: 23.47, currency: 'EUR', date: '2026-11-08', transactionType: 'expense', imagePath: 'x' }, // already has a photo
        { id: 'd', merchant: 'Lidl', total: 23.47, currency: 'EUR', date: '2026-11-12', transactionType: 'expense' }, // too far
        { id: 'e', merchant: 'Lidl', total: 23.47, currency: 'USD', date: '2026-11-08', transactionType: 'expense' },
        { id: 'f', merchant: 'Lidl', total: 23.47, currency: 'EUR', date: '2026-11-08', transactionType: 'expense', extraction: { pending: false } }, // already scanned
    ];
    it('matches same amount within a day, ranks the same merchant first, skips scanned/photographed/other-currency rows', () => {
        const m = findManualMatches(txs, { total: 23.47, date: '2026-11-09', merchant: 'LIDL ITALIA', currency: 'EUR' });
        expect(m.map((x) => x.transaction.id)).toEqual(['a', 'b']);
        expect(m[0].merchantMatch).toBe(true);
    });
    it('needs a positive amount and a date', () => {
        expect(findManualMatches(txs, { total: 0, date: '2026-11-09' })).toEqual([]);
        expect(findManualMatches(txs, { total: 5 })).toEqual([]);
    });
});
