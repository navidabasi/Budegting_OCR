import { describe, expect, it } from 'vitest';
import { currencySymbol, decimalSeparator, formatAmount, formatMoney, localeFor } from '../format';

describe('format', () => {
    it('formats 1.240,30 for Italian and German locales', () => {
        expect(formatAmount(1240.3, { locale: 'it-IT' })).toBe('1.240,30');
        expect(formatAmount(1240.3, { locale: 'de-DE' })).toBe('1.240,30');
    });
    it('uses a decimal point for English', () => {
        expect(formatAmount(1240.3, { locale: 'en-US' })).toBe('1,240.30');
    });
    it('maps languages to locales', () => {
        expect(localeFor('it', 'EUR')).toBe('it-IT');
        expect(localeFor('en', 'EUR')).toBe('en-IE');
        expect(localeFor('en', 'USD')).toBe('en-US');
    });
    it('knows the decimal separator', () => {
        expect(decimalSeparator('it-IT')).toBe(',');
        expect(decimalSeparator('en-US')).toBe('.');
    });
    it('builds button-style money text', () => {
        expect(formatMoney(23.47, 'EUR', 'it-IT')).toBe('23,47 €');
        expect(currencySymbol('USD', 'en-US')).toBe('$');
    });
    it('returns empty text for non-numbers', () => {
        expect(formatAmount(NaN)).toBe('');
    });
});
