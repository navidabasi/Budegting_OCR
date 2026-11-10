import { describe, it, expect } from 'vitest'
import { buildAggregates, hashAggregates, goalProgress } from '../insightsAggregates'
import { stableStringify, hashObject } from '../../utils/stableHash'

let n = 0
const tx = (o) => ({ id: `secret-id-${++n}`, date: '2026-11-05', total: 10, currency: 'EUR', category: 'Groceries', merchant: 'Some shop', transactionType: 'expense', ...o })

const accounts = [
    { id: 'cur', name: 'Revolut Private Account', kind: 'spending', currency: 'EUR', openingBalance: 100, openingDate: '2026-01-01' },
    { id: 'sav', name: 'Savings', kind: 'savings', currency: 'EUR', openingBalance: 0, openingDate: '2026-01-01' },
]
const goals = [
    { id: 'g1', name: 'Japan', targetAmount: 3000, targetDate: '2027-05-31', startingAmount: 200 },
    { id: 'g2', name: 'Old', targetAmount: 100, isArchived: true },
    { id: 'g3', name: 'Emergency', targetAmount: 1000, accountId: 'sav' },
]
const transactions = [
    tx({ merchant: 'LIDL ITALIA S.R.L. 0231 TORINO', notes: 'secret note about my doctor', total: 50, lineItems: [{ name: 'SECRET ITEM', price: 50 }] }),
    tx({ merchant: 'LIDL ITALIA S.R.L. 0231 TORINO', total: 30, date: '2026-10-05' }),
    tx({ merchant: 'PAGAMENTO POS ESSELUNGA SPA', total: 70, date: '2026-09-05' }),
    tx({ merchant: 'x', transactionType: 'income', total: 2000, date: '2026-11-01', accountId: 'cur', category: undefined }),
    tx({ merchant: 'x', transactionType: 'transfer', total: 300, date: '2026-11-02', accountId: 'cur', toAccountId: 'sav', goalId: 'g1', notes: 'for japan' }),
    tx({ merchant: 'x', transactionType: 'transfer', total: 100, date: '2026-11-03', accountId: 'cur', toAccountId: 'sav' }),
]
const input = { transactions, budgets: [{ id: 'b', category: 'Groceries', amount: 100, startsOn: '2026-11-01' }], goals, accounts, trips: [{ id: 'tr', kind: 'trip', name: 'Lisbon', startsOn: '2026-11-01', endsOn: '2026-11-03', budgetAmount: 500 }], month: '2026-11', today: '2026-11-20' }

describe('buildAggregates', () => {
    const agg = buildAggregates(input)

    it('has the documented sections', () => {
        expect(Object.keys(agg).sort()).toEqual(['budgets', 'categoriesByMonth', 'currency', 'dayOfMonth', 'daysInMonth', 'findings', 'goals', 'month', 'monthState', 'recurring', 'savingsSeries', 'summary', 'topMerchants', 'trips', 'version'])
        expect(agg.month).toBe('2026-11')
        expect(agg.dayOfMonth).toBe(20)
        expect(agg.summary).toMatchObject({ spent: 50, income: 2000, saved: 400 })
        expect(Object.keys(agg.categoriesByMonth)).toHaveLength(12)
        expect(agg.categoriesByMonth['2026-11']).toEqual({ Groceries: 50 })
        expect(agg.categoriesByMonth['2026-09']).toEqual({ Groceries: 70 })
        expect(agg.savingsSeries).toHaveLength(12)
        expect(agg.savingsSeries.at(-1)).toMatchObject({ month: '2026-11', income: 2000, saved: 400, savingsRate: 0.2 })
    })

    it('merchants are only key + display name', () => {
        expect(agg.topMerchants).toEqual([{ key: 'lidl', name: 'Lidl', total: 50, count: 1 }])
    })

    it('budgets, goals and trips are summarised', () => {
        expect(agg.budgets).toEqual([{ category: 'Groceries', budget: 100, spent: 50, status: 'ok', projected: 75, pacePct: 67 }])
        expect(agg.goals.map((g) => g.name)).toEqual(['Japan', 'Emergency']) // archived goal dropped
        expect(agg.goals[0]).toMatchObject({ target: 3000, saved: 500, remaining: 2500, pct: 17, targetDate: '2027-05-31' })
        expect(agg.goals[0].neededPerMonth).toBeCloseTo(2500 / 6, 1)
        expect(agg.trips).toEqual([{ name: 'Lisbon', startsOn: '2026-11-01', endsOn: '2026-11-03', budget: 500 }])
    })

    it('PRIVACY: no notes, raw descriptions, items, ids, account names or legal-entity text', () => {
        const text = JSON.stringify(agg)
        for (const forbidden of ['secret note', 'doctor', 'SECRET ITEM', 'secret-id', 'S.R.L.', '0231', 'TORINO', 'PAGAMENTO POS', 'Revolut Private Account', 'for japan']) {
            expect(text).not.toContain(forbidden)
        }
        expect(text).not.toMatch(/"(id|notes|lineItems|description|merchantRaw|accountId)"/)
    })

    it('is JSON-safe and deterministic', () => {
        expect(JSON.parse(JSON.stringify(agg))).toEqual(agg)
        expect(stableStringify(buildAggregates(input))).toBe(stableStringify(agg))
        expect(stableStringify(buildAggregates({ ...input, transactions: [...transactions].reverse() }))).toBe(stableStringify(agg))
    })

    it('includes the engine findings (type, severity, text only)', () => {
        const withBudget = buildAggregates({ ...input, budgets: [{ id: 'b', category: 'Groceries', amount: 40, startsOn: '2026-11-01' }] })
        const over = withBudget.findings.find((f) => f.type === 'budget_over')
        expect(over).toBeTruthy()
        expect(Object.keys(over).sort()).toEqual(['amount', 'body', 'category', 'merchant', 'severity', 'title', 'type'])
    })

    it('handles empty input', () => {
        const empty = buildAggregates({ month: '2026-11', today: '2026-11-20' })
        expect(empty.summary.spent).toBe(0)
        expect(empty.topMerchants).toEqual([])
        expect(empty.goals).toEqual([])
    })
})

describe('goalProgress', () => {
    const balances = [{ id: 'sav', balance: 640 }]
    it('starting amount plus transfers tagged with the goal', () => {
        expect(goalProgress(goals[0], transactions, balances)).toBe(500)
    })
    it('falls back to the account balance when no transfer uses the goal', () => {
        expect(goalProgress(goals[2], transactions, balances)).toBe(640)
    })
    it('without tagged transfers or an account it is just the starting amount', () => {
        expect(goalProgress({ id: 'z', startingAmount: 50 }, [], [])).toBe(50)
    })
})

describe('hashAggregates', () => {
    const agg = buildAggregates(input)

    it('is stable and independent of key order', () => {
        expect(hashAggregates(agg)).toBe(hashAggregates(JSON.parse(JSON.stringify(agg))))
        const shuffled = Object.fromEntries(Object.entries(agg).reverse())
        expect(hashAggregates(shuffled)).toBe(hashAggregates(agg))
        expect(hashAggregates(agg)).toMatch(/^[0-9a-f]{14}$/)
    })
    it('changes when the data changes or the language differs', () => {
        const more = buildAggregates({ ...input, transactions: [...transactions, tx({ merchant: 'Lidl', total: 5 })] })
        expect(hashAggregates(more)).not.toBe(hashAggregates(agg))
        expect(hashAggregates(agg, { language: 'it' })).not.toBe(hashAggregates(agg, { language: 'en' }))
    })
    it('does not change just because a day passed', () => {
        const tomorrow = buildAggregates({ ...input, today: '2026-11-21' })
        expect(tomorrow.dayOfMonth).toBe(21)
        expect(hashAggregates(tomorrow)).toBe(hashAggregates(agg))
    })
})

describe('stableHash', () => {
    it('sorts keys, drops undefined, handles nesting', () => {
        expect(stableStringify({ b: 1, a: [{ d: 1, c: undefined }] })).toBe('{"a":[{"d":1}],"b":1}')
        expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ b: 2, a: 1 }))
        expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }))
        expect(stableStringify(null)).toBe('null')
    })
})
