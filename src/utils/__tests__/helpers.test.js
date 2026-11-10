import { describe, it, expect } from 'vitest'
import { parseLocalNumber, extractDateFromText, getEffectiveAmount } from '../helpers'

describe('parseLocalNumber', () => {
    it('returns 0 for empty values and passes numbers through', () => {
        expect(parseLocalNumber('')).toBe(0)
        expect(parseLocalNumber(null)).toBe(0)
        expect(parseLocalNumber(12.5)).toBe(12.5)
        expect(parseLocalNumber('abc')).toBe(0)
    })
    it('parses US and EU decimals', () => {
        expect(parseLocalNumber('1.49')).toBe(1.49)
        expect(parseLocalNumber('1,49')).toBe(1.49)
    })
    it('parses thousands separators in both conventions', () => {
        expect(parseLocalNumber('1.234,56')).toBe(1234.56)
        expect(parseLocalNumber('1,234.56')).toBe(1234.56)
    })
    it('strips currency symbols and whitespace', () => {
        expect(parseLocalNumber('€ 23,47')).toBe(23.47)
        expect(parseLocalNumber('$1,000.00')).toBe(1000)
    })
})

describe('extractDateFromText', () => {
    const iso = (y, m, d) => new Date(y, m - 1, d).toISOString()
    it('returns null when nothing matches', () => {
        expect(extractDateFromText('')).toBeNull()
        expect(extractDateFromText('no date here')).toBeNull()
    })
    it('parses European DD/MM/YYYY', () => {
        expect(extractDateFromText('Data 15/01/2024 ore 18:42')).toBe(iso(2024, 1, 15))
        expect(extractDateFromText('15.01.2024')).toBe(iso(2024, 1, 15))
    })
    it('parses ISO dates', () => {
        expect(extractDateFromText('2026-11-08')).toBe(iso(2026, 11, 8))
    })
    it('parses short years', () => {
        expect(extractDateFromText('08-11-26')).toBe(iso(2026, 11, 8))
    })
    it('parses written dates', () => {
        expect(extractDateFromText('15 Jan 2024')).toBe(iso(2024, 1, 15))
        expect(extractDateFromText('January 15, 2024')).toBe(iso(2024, 1, 15))
    })
})

describe('getEffectiveAmount', () => {
    it('handles missing receipts and plain totals', () => {
        expect(getEffectiveAmount(null)).toBe(0)
        expect(getEffectiveAmount({ total: '12.5' })).toBe(12.5)
    })
    it('uses the stored yourShare when split', () => {
        expect(getEffectiveAmount({ total: 100, splitData: { yourShare: 30 } })).toBe(30)
    })
    it('divides equally for equal splits', () => {
        expect(getEffectiveAmount({ total: 90, splitData: { method: 'equal', people: 3 } })).toBe(30)
    })
    it('uses the first user for custom splits', () => {
        expect(getEffectiveAmount({ total: 90, splitData: { method: 'custom', users: [{ amount: '25' }, { amount: '65' }] } })).toBe(25)
    })
    it('falls back to equal split', () => {
        expect(getEffectiveAmount({ total: 50, splitData: { people: 2 } })).toBe(25)
    })
})
