import { describe, it, expect } from 'vitest'
import { budgetStatus, categoryBudgets, copyForward, suggestBudget, activeBudgets } from '../budgetMath'

let n = 0
const tx = (o) => ({ id: `t${++n}`, date: '2026-11-05', total: 10, currency: 'EUR', category: 'Dining', transactionType: 'expense', ...o })

describe('budgetStatus', () => {
    it('on track', () => {
        const s = budgetStatus({ budget: 300, spent: 100, date: '2026-11-15' })
        expect(s.remaining).toBe(200)
        expect(s.pacePct).toBe(50)
        expect(s.spentPct).toBeCloseTo(33.33, 1)
        expect(s.projected).toBe(200)
        expect(s.status).toBe('ok')
        expect(s.perDayToStay).toBeCloseTo(200 / 16, 6) // days 15..30
    })
    it('warning when the projection exceeds the budget after day 5', () => {
        const s = budgetStatus({ budget: 300, spent: 200, date: '2026-11-15' })
        expect(s.projected).toBe(400)
        expect(s.status).toBe('warning')
    })
    it('does not warn on a big early purchase before day 5', () => {
        expect(budgetStatus({ budget: 300, spent: 100, date: '2026-11-02' }).status).toBe('ok')
    })
    it('warning at 90 % even if the projection looks fine', () => {
        expect(budgetStatus({ budget: 100, spent: 90, date: '2026-11-30' }).status).toBe('warning')
    })
    it('over', () => {
        const s = budgetStatus({ budget: 100, spent: 120, date: '2026-11-20' })
        expect(s.status).toBe('over')
        expect(s.remaining).toBe(-20)
        expect(s.perDayToStay).toBe(0)
    })
    it('exactly on budget is not over', () => {
        expect(budgetStatus({ budget: 100, spent: 100, date: '2026-11-30' }).status).toBe('warning')
    })
    it('no budget -> ok with null fields', () => {
        expect(budgetStatus({ budget: 0, spent: 50, date: '2026-11-10' })).toMatchObject({ status: 'ok', remaining: null, perDayToStay: null })
        expect(budgetStatus({})).toMatchObject({ status: 'ok' })
    })
    it('last day of the month: all remaining money is for today', () => {
        expect(budgetStatus({ budget: 100, spent: 60, date: '2026-11-30' }).perDayToStay).toBe(40)
    })
})

describe('activeBudgets / copyForward', () => {
    const budgets = [
        { id: '1', category: '*', amount: 2000, currency: 'EUR', startsOn: '2026-09-01', endsOn: null },
        { id: '2', category: 'Dining', amount: 150, currency: 'EUR', startsOn: '2026-09-01', endsOn: null },
        { id: '3', category: 'Dining', amount: 180, currency: 'EUR', startsOn: '2026-10-01', endsOn: null },
        { id: '4', category: 'Fuel', amount: 80, currency: 'EUR', startsOn: '2026-08-01', endsOn: '2026-09-30' },
    ]
    it('picks the latest row per category and respects endsOn', () => {
        const a = activeBudgets(budgets, '2026-11')
        expect(a.map((b) => b.id).sort()).toEqual(['1', '3'])
        expect(activeBudgets(budgets, '2026-09').map((b) => b.id).sort()).toEqual(['1', '2', '4'])
        expect(activeBudgets(budgets, '2026-07')).toEqual([])
    })
    it('copyForward creates next-month rows for active budgets only', () => {
        const rows = copyForward(budgets, '2026-11')
        expect(rows).toEqual([
            { category: '*', amount: 2000, currency: 'EUR', startsOn: '2026-11-01', endsOn: null },
            { category: 'Dining', amount: 180, currency: 'EUR', startsOn: '2026-11-01', endsOn: null },
        ])
    })
    it('copyForward is idempotent: skips categories that already have a row for the month', () => {
        const withNov = [...budgets, { id: '5', category: 'Dining', amount: 200, currency: 'EUR', startsOn: '2026-11-01' }]
        expect(copyForward(withNov, '2026-11').map((r) => r.category)).toEqual(['*'])
        expect(copyForward([], '2026-11')).toEqual([])
    })
})

describe('categoryBudgets', () => {
    const budgets = [
        { id: 'w', category: '*', amount: 1000, currency: 'EUR', startsOn: '2026-11-01' },
        { id: 'd', category: 'Dining', amount: 100, currency: 'EUR', startsOn: '2026-11-01' },
        { id: 'g', category: 'Groceries', amount: 400, currency: 'EUR', startsOn: '2026-11-01' },
    ]
    const trips = [{ id: 'trip1', name: 'Japan', kind: 'trip', excludeFromBudgets: true }]
    const txs = [
        tx({ category: 'Dining', total: 60 }),
        tx({ category: 'Dining', total: 300, groupId: 'trip1' }), // trip: not counted against Dining
        tx({ category: 'Groceries', total: 100 }),
        tx({ category: 'Dining', total: 999, date: '2026-10-20' }),
        tx({ category: 'Dining', total: 25, transactionType: 'income' }),
        tx({ category: 'Dining', total: 25, trackingData: { isTracked: true, status: 'open' } }),
    ]
    const rows = categoryBudgets(budgets, txs, '2026-11', trips, { today: '2026-11-15' })

    it('leaves trip spend out of category budgets but keeps it in the whole-month budget', () => {
        const byCat = Object.fromEntries(rows.map((r) => [r.category, r]))
        expect(byCat.Dining.spent).toBe(60)
        expect(byCat.Groceries.spent).toBe(100)
        expect(byCat['*'].spent).toBe(460) // 60 + 300 + 100
    })
    it('adds status fields and sorts whole-month first', () => {
        expect(rows[0].category).toBe('*')
        const dining = rows.find((r) => r.category === 'Dining')
        expect(dining).toMatchObject({ amount: 100, remaining: 40, status: 'warning' }) // 60 by day 15 projects to 120
        expect(rows[1].category).toBe('Dining') // highest share first
    })
    it('a past month is evaluated at month end, a future one at its start', () => {
        const past = categoryBudgets([{ id: 'd', category: 'Dining', amount: 100, startsOn: '2026-09-01' }], [tx({ category: 'Dining', total: 50, date: '2026-09-10' })], '2026-09', [], { today: '2026-11-15' })
        expect(past[0]).toMatchObject({ pacePct: 100, status: 'ok', projected: 50 })
        const future = categoryBudgets([{ id: 'd', category: 'Dining', amount: 100, startsOn: '2026-11-01' }], [], '2026-12', [], { today: '2026-11-15' })
        expect(future[0].spent).toBe(0)
    })
    it('no budgets -> no rows', () => {
        expect(categoryBudgets([], txs, '2026-11', trips)).toEqual([])
    })
})

describe('suggestBudget', () => {
    const history = [
        tx({ category: 'Dining', total: 90, date: '2026-08-10' }),
        tx({ category: 'Dining', total: 120, date: '2026-09-10' }),
        tx({ category: 'Dining', total: 150, date: '2026-10-10' }),
        tx({ category: 'Dining', total: 500, date: '2026-11-10' }), // current month is not part of the average
        tx({ category: 'Groceries', total: 60, date: '2026-10-02' }),
    ]
    it('averages the three previous months', () => {
        expect(suggestBudget(history, 'Dining', '2026-11')).toBe(120)
    })
    it('averages from the first month with data, not over empty history', () => {
        expect(suggestBudget(history, 'Groceries', '2026-11')).toBe(60)
    })
    it('counts a gap month as zero once history has started', () => {
        const h = [tx({ category: 'Dining', total: 90, date: '2026-08-10' }), tx({ category: 'Dining', total: 90, date: '2026-10-10' })]
        expect(suggestBudget(h, 'Dining', '2026-11')).toBe(60)
    })
    it('null without history; whole-month suggestion sums all categories', () => {
        expect(suggestBudget(history, 'Fuel', '2026-11')).toBeNull()
        expect(suggestBudget([], 'Dining', '2026-11')).toBeNull()
        expect(suggestBudget(history, '*', '2026-11')).toBe(Math.round((90 + 120 + 210) / 3))
    })
    it('leaves trip spend out of category suggestions', () => {
        const h = [tx({ category: 'Dining', total: 100, date: '2026-10-10' }), tx({ category: 'Dining', total: 400, date: '2026-10-12', groupId: 't' })]
        expect(suggestBudget(h, 'Dining', '2026-11', { trips: [{ id: 't', kind: 'trip' }] })).toBe(100)
    })
})
