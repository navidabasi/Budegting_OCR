import { describe, it, expect } from 'vitest'
import { activeTrip, tripTotals, tripContainsDate } from '../tripMath'

let n = 0
const tx = (o) => ({ id: `t${++n}`, date: '2026-11-05', total: 10, currency: 'EUR', category: 'Dining', transactionType: 'expense', groupId: 'trip1', ...o })

const japan = { id: 'trip1', kind: 'trip', name: 'Japan', startsOn: '2026-11-03', endsOn: '2026-11-06', budgetAmount: 800, isActive: false }

describe('activeTrip', () => {
    it('is active inside its date range (inclusive) and null outside', () => {
        expect(activeTrip([japan], '2026-11-03')?.id).toBe('trip1')
        expect(activeTrip([japan], '2026-11-06')?.id).toBe('trip1')
        expect(activeTrip([japan], '2026-11-07')).toBeNull()
        expect(activeTrip([japan], '2026-11-02')).toBeNull()
    })
    it('a manual start wins and ignores dates', () => {
        const manual = { id: 'm', kind: 'trip', isActive: true, startsOn: null, endsOn: null }
        expect(activeTrip([japan, manual], '2026-11-04')?.id).toBe('m')
        expect(activeTrip([{ ...japan, isActive: true }], '2026-12-31')?.id).toBe('trip1')
    })
    it('open-ended trips are active once started; most recent start wins ties', () => {
        const a = { id: 'a', kind: 'trip', startsOn: '2026-10-01' }
        const b = { id: 'b', kind: 'trip', startsOn: '2026-11-01' }
        expect(activeTrip([a, b], '2026-11-10')?.id).toBe('b')
    })
    it('ignores groups that are not trips and empty input', () => {
        expect(activeTrip([{ id: 'g', kind: 'group', isActive: true }], '2026-11-04')).toBeNull()
        expect(activeTrip([], '2026-11-04')).toBeNull()
        expect(activeTrip(undefined, '2026-11-04')).toBeNull()
    })
})

describe('tripTotals', () => {
    const txs = [
        tx({ total: 100, category: 'Travel', date: '2026-11-03' }),
        tx({ total: 60, category: 'Dining', date: '2026-11-03' }),
        tx({ total: 40, category: 'Dining', date: '2026-11-04', amountBase: 36 }),
        tx({ total: 80, category: 'Dining', date: '2026-11-04', splitData: { method: 'equal', people: 2 } }),
        tx({ total: 20, transactionType: 'income', date: '2026-11-05' }), // refund
        tx({ total: 500, groupId: 'other' }),
        tx({ total: 30, trackingData: { isTracked: true, status: 'open' } }),
    ]

    it('total, your share, per day and categories', () => {
        const t = tripTotals(japan, txs, { today: '2026-11-04' })
        expect(t.total).toBe(100 + 60 + 36 + 80 - 20)
        expect(t.yourShare).toBe(100 + 60 + 36 + 40 - 20)
        expect(t.daysElapsed).toBe(2)
        expect(t.days).toBe(4)
        expect(t.perDay).toBe(128)
        expect(t.byCategory).toEqual([
            { category: 'Dining', total: 176 },
            { category: 'Travel', total: 100 },
        ])
        expect(t.count).toBe(5)
    })

    it('budget progress', () => {
        const t = tripTotals(japan, txs, { today: '2026-11-04' })
        expect(t.budget).toBe(800)
        expect(t.remaining).toBe(800 - 256)
        expect(t.budgetPct).toBeCloseTo(32, 5)
    })

    it('days elapsed stops at the end date and is 0 before the start', () => {
        expect(tripTotals(japan, txs, { today: '2026-12-25' }).daysElapsed).toBe(4)
        const before = tripTotals(japan, [tx({ total: 50, date: '2026-11-01' })], { today: '2026-11-02' })
        expect(before.daysElapsed).toBe(0)
        expect(before.perDay).toBe(50)
    })

    it('open-ended trips have no length; start falls back to the first transaction', () => {
        const open = { id: 'trip1', kind: 'trip', startsOn: null, endsOn: null }
        const t = tripTotals(open, [tx({ date: '2026-11-01', total: 30 }), tx({ date: '2026-11-03', total: 30 })], { today: '2026-11-03' })
        expect(t.days).toBeNull()
        expect(t.daysElapsed).toBe(3)
        expect(t.perDay).toBe(20)
        expect(t.budget).toBeNull()
    })

    it('empty trip', () => {
        const t = tripTotals(japan, [], { today: '2026-11-04' })
        expect(t).toMatchObject({ total: 0, perDay: 0, yourShare: 0, byCategory: [], count: 0 })
    })
})

describe('tripContainsDate', () => {
    it('is inclusive and handles open ends', () => {
        expect(tripContainsDate(japan, '2026-11-03')).toBe(true)
        expect(tripContainsDate(japan, '2026-11-06')).toBe(true)
        expect(tripContainsDate(japan, '2026-11-07')).toBe(false)
        expect(tripContainsDate({ startsOn: '2026-11-01' }, '2026-12-01')).toBe(true)
        expect(tripContainsDate({}, '2026-12-01')).toBe(false)
    })
})
