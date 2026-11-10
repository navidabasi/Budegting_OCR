import { describe, it, expect } from 'vitest'
import seeds from '../merchantSeeds.json'
import { merchantKey, displayName, findSeed } from '../merchant'
import { EXPENSE_CATEGORIES } from '../categoryNames'

describe('merchantKey', () => {
    it.each([
        ['LIDL 0231 TORINO', 'lidl'],
        ['PAGAMENTO POS ESSELUNGA SPA', 'esselunga'],
        ['Card payment to Q8 TORINO NORD', 'q8'],
        ['LIDL ITALIA S.R.L. SOCIETA A SOCIO UNICO', 'lidl'],
        ["McDonald's Via Roma 12", 'mcdonalds'],
        ['H&M', 'hm'],
        ['Amazon.it', 'amazon'],
        ['Booking.com', 'booking'],
        ['APPLE.COM/BILL', 'apple bill'],
        ['PayPal *SPOTIFY', 'spotify'],
        ['Conad City Via Verdi 5 BO', 'conad'],
        ['COOP LOMBARDIA 0045 MILANO MI', 'coop lombardia'],
        ['Caffè Mario', 'caffe mario'],
        ['  Esselunga   S.p.A.  ', 'esselunga'],
        ['Acquisto POS CARREFOUR EXPRESS 12/11 14:32', 'carrefour express'],
        ['Rewe Markt GmbH', 'rewe markt'],
    ])('%s -> %s', (raw, key) => {
        expect(merchantKey(raw)).toBe(key)
    })

    it('is empty for empty-ish input and never throws', () => {
        expect(merchantKey('')).toBe('')
        expect(merchantKey(null)).toBe('')
        expect(merchantKey(undefined)).toBe('')
    })

    it('is stable: same key for spelling variants', () => {
        expect(merchantKey('Lidl')).toBe(merchantKey('LIDL ITALIA SRL'))
        expect(merchantKey('lidl 1234 Milano')).toBe(merchantKey('LIDL'))
    })

    it('keeps a lone word even if it looks like a city or legal form', () => {
        expect(merchantKey('Torino')).toBe('torino')
        expect(merchantKey('SPA')).toBe('spa')
    })
})

describe('displayName', () => {
    it('uses the seed display for known brands', () => {
        expect(displayName('PAGAMENTO POS ESSELUNGA SPA')).toBe('Esselunga')
        expect(displayName('LIDL 0231 TORINO')).toBe('Lidl')
        expect(displayName('MCDONALDS 123')).toBe("McDonald's")
    })
    it('title-cases unknown names and keeps generic descriptors in the name', () => {
        expect(displayName('TRATTORIA DA MARIO')).toBe('Trattoria da Mario')
        expect(displayName('Bar Sport')).toBe('Bar Sport')
    })
    it('returns empty for empty input', () => {
        expect(displayName('')).toBe('')
    })
})

describe('merchantSeeds.json', () => {
    it('has a healthy number of entries with valid shape', () => {
        expect(seeds.length).toBeGreaterThanOrEqual(250)
        for (const s of seeds) {
            expect(typeof s.pattern).toBe('string')
            expect(typeof s.display).toBe('string')
            expect(EXPENSE_CATEGORIES).toContain(s.category)
            expect(() => new RegExp(s.pattern)).not.toThrow()
        }
    })
    it('uses word boundaries or anchors in every pattern', () => {
        for (const s of seeds) expect(s.pattern.startsWith('^') || s.pattern.startsWith('\\b')).toBe(true)
    })
    it('findSeed returns null for unknown keys', () => {
        expect(findSeed('zzzz qqqq')).toBeNull()
        expect(findSeed('')).toBeNull()
    })
})
