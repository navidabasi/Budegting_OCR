import { describe, it, expect } from 'vitest'
import { suggestCategory, suggestForMerchant } from '../categorizer'

const cat = (merchant, extra = {}) => suggestCategory({ merchant, ...extra })

describe('suggestCategory: seeds on merchants and bank descriptions', () => {
    it.each([
        // Groceries
        ['Lidl', 'Groceries'], ['LIDL 0231 TORINO', 'Groceries'], ['PAGAMENTO POS ESSELUNGA SPA', 'Groceries'],
        ['Conad City', 'Groceries'], ['COOP LOMBARDIA', 'Groceries'], ['Carrefour Express', 'Groceries'], ['Eurospin', 'Groceries'],
        ['MD SPA', 'Groceries'], ['Aldi Süd', 'Groceries'], ['Mercadona', 'Groceries'], ['Albert Heijn 1234', 'Groceries'], ['REWE Markt GmbH', 'Groceries'],
        ['Monoprix', 'Groceries'], ['Tesco Stores', 'Groceries'], ['Edeka', 'Groceries'], ['Jumbo', 'Groceries'], ['Spar', 'Groceries'],
        // Fuel
        ['Card payment to Q8 TORINO NORD', 'Fuel'], ['ENI STATION 1234', 'Fuel'], ['Shell Italia', 'Fuel'], ['BP', 'Fuel'], ['Tamoil', 'Fuel'], ['IP Station', 'Fuel'],
        // Transport
        ['Trenitalia', 'Transport'], ['ITALO - NTV SPA', 'Transport'], ['ATM Milano', 'Transport'], ['GTT Torino', 'Transport'], ['Uber *TRIP', 'Transport'],
        ['FreeNow', 'Transport'], ['Bolt', 'Transport'], ['Telepass', 'Transport'], ['Frecciarossa', 'Transport'],
        // Travel
        ['Ryanair', 'Travel'], ['easyJet', 'Travel'], ['ITA Airways', 'Travel'], ['Airbnb', 'Travel'], ['Booking.com', 'Travel'],
        // Utilities / telco
        ['Enel Energia', 'Utilities'], ['Edison', 'Utilities'], ['A2A Energia', 'Utilities'], ['Hera Comm', 'Utilities'], ['Eni Plenitude', 'Utilities'],
        ['TIM', 'Utilities'], ['Vodafone', 'Utilities'], ['WindTre', 'Utilities'], ['Iliad', 'Utilities'], ['Fastweb', 'Utilities'], ['Ho. Mobile', 'Utilities'],
        // Subscriptions
        ['Netflix.com', 'Subscriptions'], ['PayPal *SPOTIFY', 'Subscriptions'], ['APPLE.COM/BILL', 'Subscriptions'], ['Amazon Prime', 'Subscriptions'],
        // Shopping
        ['Amazon.it', 'Shopping'], ['AMZN Mktp IT', 'Shopping'], ['Zalando', 'Shopping'], ['IKEA Italia', 'Shopping'], ['Decathlon', 'Shopping'],
        ['MediaWorld', 'Shopping'], ['Unieuro', 'Shopping'], ['H&M', 'Shopping'],
        // Housing
        ['Leroy Merlin', 'Housing'],
        // Dining incl. delivery
        ["McDonald's", 'Dining'], ['Glovo', 'Dining'], ['Deliveroo', 'Dining'], ['Just Eat', 'Dining'], ['Uber Eats', 'Dining'], ['Bolt Food', 'Dining'], ['Ristorante Da Mario', 'Dining'],
        ['Pizzeria Napoli', 'Dining'], ['Bar Sport', 'Dining'],
        // Health & fees & insurance
        ['Farmacia Comunale', 'Health'], ['COMMISSIONI BANCARIE', 'Fees'], ['Canone conto', 'Fees'], ['Generali Assicurazioni', 'Insurance'],
    ])('%s -> %s', (merchant, expected) => {
        const r = cat(merchant)
        expect(r.category).toBe(expected)
        expect(r.source).toBe('seed')
        expect(r.confidence).toBeGreaterThan(0.6)
    })

    it('returns the merchantKey alongside the suggestion', () => {
        expect(cat('LIDL 0231 TORINO').merchantKey).toBe('lidl')
    })
})

describe('suggestCategory: false positives', () => {
    it.each([
        ['Busta paga'], ['Pagamento busta'], ['BPM'], ['Banco BPM spa'], ['Targets Group'], ['Shellac Nails Studio'],
        ['Gasparri Mario'], ['Trainer Pro'], ['Bustaro'], ['Phone Case Store'],
    ])('%s is not matched by a short keyword', (merchant) => {
        const r = cat(merchant)
        expect(['Fuel', 'Transport', 'Shopping', 'Utilities']).not.toContain(r.category)
    })

    it('gastronomia is Groceries (shop), never Fuel', () => {
        expect(cat('Gastronomia Rossi').category).toBe('Groceries')
    })

    it('ristorante is Dining while ristrutturazione is not', () => {
        expect(cat('Ristorante Bellavista').category).toBe('Dining')
        expect(cat('Ristrutturazione Casa srl').category).not.toBe('Dining')
    })

    it('bpm does not become BP fuel', () => {
        expect(cat('BPM').category).toBeNull()
        expect(cat('BP').category).toBe('Fuel')
    })

    it('unknown merchants resolve to none', () => {
        expect(cat('Zzxq Holdings')).toMatchObject({ category: null, source: 'none', confidence: 0 })
        expect(cat('')).toMatchObject({ category: null, source: 'none' })
    })
})

describe('suggestCategory: user rules', () => {
    const rules = [
        { merchantKey: 'lidl', category: 'Dining', hitCount: 3 },
        { merchantKey: 'mario rossi', category: 'Gifts', hitCount: 1 },
        { merchantKey: 'pizzeria', category: 'Groceries', hitCount: 2 },
        { merchantKey: 'bar centrale', category: 'Entertainment', hitCount: 1 },
    ]
    it('exact key beats seeds', () => {
        const r = cat('LIDL 0231 TORINO', { rules })
        expect(r).toMatchObject({ category: 'Dining', source: 'user', confidence: 1 })
    })
    it('rule key as token prefix of a longer key', () => {
        const r = cat('Mario Rossi Parrucchiere', { rules })
        expect(r).toMatchObject({ category: 'Gifts', source: 'user', confidence: 0.9 })
    })
    it('first-word match when no exact or prefix rule exists', () => {
        const r = cat('Pizzeria Da Gigi', { rules: [{ merchantKey: 'pizzeria roma', category: 'Groceries', hitCount: 2 }] })
        expect(r).toMatchObject({ category: 'Groceries', source: 'user', confidence: 0.7 })
    })
    it('does not match a short first word', () => {
        const r = cat('Bar Sport', { rules: [{ merchantKey: 'bar centrale', category: 'Entertainment' }] })
        expect(r.source).toBe('seed')
    })
    it('falls through to seeds without rules', () => {
        expect(cat('LIDL', { rules: [] }).category).toBe('Groceries')
    })
})

describe('suggestCategory: item keywords', () => {
    it('uses the dominant item category when the merchant is unknown', () => {
        const items = [{ name: 'Latte intero 1L' }, { name: 'Pane integrale' }, { name: 'Mozzarella' }, { name: 'Shampoo' }]
        const r = cat('Bottega Rossi', { items })
        expect(r.category).toBe('Groceries')
        expect(r.source).toBe('items')
        expect(r.confidence).toBeLessThanOrEqual(0.6)
    })
    it('understands English and plain strings', () => {
        expect(cat('Corner Store', { items: ['milk', 'bread', 'eggs'] }).category).toBe('Groceries')
        expect(cat('Zzz Station', { items: ['Unleaded 95', 'self service'] }).category).toBe('Fuel')
    })
    it('detects restaurant bills', () => {
        expect(cat('Da Gigi srl', { items: [{ name: 'Coperto' }, { name: 'Antipasto misto' }, { name: 'Tiramisu' }] }).category).toBe('Dining')
    })
    it('a seed match on the merchant beats item keywords', () => {
        expect(cat('Lidl', { items: [{ name: 'Shampoo' }, { name: 'Dentifricio' }] }).category).toBe('Groceries')
    })
    it('word boundary: "bus" in "busta" never matches', () => {
        expect(cat('Foo', { items: [{ name: 'Busta paga' }] }).category).toBeNull()
    })
    it('returns none for unreadable items', () => {
        expect(cat('Foo', { items: [{ name: 'ABC123' }, { name: 'XYZ' }] }).source).toBe('none')
    })
})

describe('suggestForMerchant (forms re-suggest when the merchant changes)', () => {
    const names = ['Groceries', 'Dining', 'Other']
    it('a learned user rule beats history and seeds', () => {
        const rules = [{ merchantKey: 'lidl', category: 'Dining', hitCount: 2 }]
        const transactions = [{ merchant: 'Lidl', category: 'Groceries', date: '2026-11-01' }]
        expect(suggestForMerchant({ merchant: 'LIDL 0231', rules, transactions, names })).toBe('Dining')
    })
    it('falls back to history, then seeds, and only returns offered names', () => {
        expect(suggestForMerchant({ merchant: 'Bar Roma', transactions: [{ merchant: 'Bar Roma', category: 'Restaurant', date: '2026-11-01' }], names })).toBe('Dining')
        expect(suggestForMerchant({ merchant: 'Conad', names })).toBe('Groceries')
        expect(suggestForMerchant({ merchant: 'Conad', names: ['Dining'] })).toBeNull()
        expect(suggestForMerchant({ merchant: '  ', names })).toBeNull()
    })
})
