import { describe, it, expect } from 'vitest'
import { findDuplicates } from '../dedupe'
import { parseRevolut } from '../parsers/revolut'

const row = (o) => ({ date: '2026-11-08', description: 'LIDL 0231 TORINO', amount: 23.47, transactionType: 'expense', importRef: 'revolut:abc', ...o })
const tx = (o) => ({ id: 't1', date: '2026-11-08', merchant: 'Lidl', total: 23.47, transactionType: 'expense', ...o })

describe('findDuplicates', () => {
    it('pairs a bank row with a scanned receipt (same amount, same day)', () => {
        const pairs = findDuplicates([row()], [tx()])
        expect(pairs).toHaveLength(1)
        expect(pairs[0]).toMatchObject({ importedIndex: 0, reason: 'match', merchantMatch: true, daysApart: 0 })
        expect(pairs[0].existing.id).toBe('t1')
    })

    it('allows 1 day apart and 0.01 amount difference, nothing more', () => {
        expect(findDuplicates([row({ date: '2026-11-09' })], [tx()])).toHaveLength(1)
        expect(findDuplicates([row({ date: '2026-11-07' })], [tx()])).toHaveLength(1)
        expect(findDuplicates([row({ date: '2026-11-10' })], [tx()])).toHaveLength(0)
        expect(findDuplicates([row({ amount: 23.48 })], [tx()])).toHaveLength(1)
        expect(findDuplicates([row({ amount: 23.5 })], [tx()])).toHaveLength(0)
    })

    it('prefers the candidate whose merchantKey matches', () => {
        const existing = [tx({ id: 'other', merchant: 'Esselunga' }), tx({ id: 'lidl', merchant: 'Lidl Italia srl' })]
        const pairs = findDuplicates([row()], existing)
        expect(pairs).toHaveLength(1)
        expect(pairs[0].existing.id).toBe('lidl')
        expect(pairs[0].merchantMatch).toBe(true)
    })

    it('still matches without a merchant match, flagged as such', () => {
        const pairs = findDuplicates([row({ description: 'POS 99887' })], [tx({ merchant: 'Corner shop' })])
        expect(pairs).toHaveLength(1)
        expect(pairs[0].merchantMatch).toBe(false)
    })

    it('uses the stored merchantKey, amountBase and total', () => {
        const pairs = findDuplicates([row({ amount: 21.6 })], [tx({ merchant: 'x', merchantKey: 'lidl', total: 23.47, amountBase: 21.6 })])
        expect(pairs).toHaveLength(1)
        expect(pairs[0].merchantMatch).toBe(true)
    })

    it('pairs each existing transaction at most once', () => {
        const imported = [row({ importRef: 'a' }), row({ importRef: 'b' })]
        const pairs = findDuplicates(imported, [tx()])
        expect(pairs).toHaveLength(1)
        const two = findDuplicates(imported, [tx(), tx({ id: 't2' })])
        expect(two.map((p) => p.existing.id).sort()).toEqual(['t1', 't2'])
    })

    it('picks the closest day when several candidates match equally', () => {
        const existing = [tx({ id: 'far', date: '2026-11-09' }), tx({ id: 'near', date: '2026-11-08' })]
        expect(findDuplicates([row()], existing)[0].existing.id).toBe('near')
    })

    it('requires the same transaction type', () => {
        expect(findDuplicates([row({ transactionType: 'income' })], [tx()])).toHaveLength(0)
        expect(findDuplicates([row({ transactionType: 'transfer' })], [tx()])).toHaveLength(0)
        expect(findDuplicates([row({ transactionType: undefined })], [tx({ transactionType: undefined })])).toHaveLength(1)
    })

    it('never pairs with a transaction that came from another bank row', () => {
        expect(findDuplicates([row()], [tx({ importRef: 'revolut:zzz' })])).toHaveLength(0)
    })

    it('recognises an exact re-import through importRef (any date or amount)', () => {
        const pairs = findDuplicates([row()], [tx({ importRef: 'revolut:abc', date: '2026-01-01', total: 1 })])
        expect(pairs).toHaveLength(1)
        expect(pairs[0].reason).toBe('import_ref')
    })

    it('handles empty inputs and rows without amounts', () => {
        expect(findDuplicates([], [tx()])).toEqual([])
        expect(findDuplicates([row()], [])).toEqual([])
        expect(findDuplicates([row({ amount: undefined })], [tx()])).toEqual([])
        expect(findDuplicates()).toEqual([])
    })
})

describe('end to end: import the same Revolut file twice', () => {
    const CSV = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-11-08 18:42:11,2026-11-09 07:10:02,LIDL 0231 TORINO,-23.47,0.00,EUR,COMPLETED,1476.53
CARD_PAYMENT,Current,2026-11-08 19:00:00,2026-11-09 07:10:02,Bar Centrale,-1.50,0.00,EUR,COMPLETED,1475.03
`
    it('second pass finds every row as an import_ref duplicate; the scanned receipt merges with its bank row', async () => {
        const first = (await parseRevolut(CSV)).rows
        const scanned = tx({ id: 'scan1' })
        const firstPairs = findDuplicates(first, [scanned])
        expect(firstPairs).toHaveLength(1)
        expect(firstPairs[0].existing.id).toBe('scan1')

        // After import, the stored transactions carry the importRef (the scanned one was merged with row 0).
        const stored = [{ ...scanned, importRef: first[0].importRef }, { id: 'b', date: '2026-11-08', merchant: 'Bar Centrale', total: 1.5, transactionType: 'expense', importRef: first[1].importRef }]
        const second = (await parseRevolut(CSV)).rows
        const pairs = findDuplicates(second, stored)
        expect(pairs).toHaveLength(2)
        expect(pairs.every((p) => p.reason === 'import_ref')).toBe(true)
    })
})
