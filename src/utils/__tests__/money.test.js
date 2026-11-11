import { describe, it, expect } from 'vitest'
import { accountBalances, monthTotals, totalBalance, fullAmount, shareAmount, spentByCategory, excludedTripIds, cumulativeSpend } from '../money'

let n = 0
const tx = (o) => ({ id: `t${++n}`, date: '2026-11-05', total: 10, currency: 'EUR', category: 'Groceries', transactionType: 'expense', ...o })

const accounts = [
    { id: 'rev', name: 'Revolut', kind: 'spending', currency: 'EUR', openingBalance: 500, openingDate: '2026-01-01' },
    { id: 'cash', name: 'Cash', kind: 'cash', currency: 'EUR', openingBalance: 0, openingDate: '2026-01-01' },
    { id: 'sav', name: 'Savings', kind: 'savings', currency: 'EUR', openingBalance: 1000, openingDate: '2026-01-01' },
    { id: 'inv', name: 'Invest', kind: 'investment', currency: 'EUR', openingBalance: 0, openingDate: '2026-01-01' },
]

describe('fullAmount / shareAmount', () => {
    it('uses amountBase ?? total', () => {
        expect(fullAmount({ total: 10 })).toBe(10)
        expect(fullAmount({ total: 10, amountBase: 9.2 })).toBe(9.2)
        expect(fullAmount({ total: '12.5' })).toBe(12.5)
        expect(fullAmount({ total: 10, amountBase: 0 })).toBe(0)
        expect(fullAmount(null)).toBe(0)
    })
    it('applies split share like getEffectiveAmount', () => {
        expect(shareAmount({ total: 100, splitData: { method: 'equal', people: 4 } })).toBe(25)
        expect(shareAmount({ total: 100, splitData: { yourShare: 30 } })).toBe(30)
        expect(shareAmount({ total: 100, splitData: { users: [{ amount: 40 }, { amount: 60 }] } })).toBe(40)
    })
    it('scales the share to the base currency', () => {
        expect(shareAmount({ total: 100, amountBase: 90, splitData: { method: 'equal', people: 2 } })).toBe(45)
        expect(shareAmount({ total: 100, amountBase: 90 })).toBe(90)
    })
})

describe('accountBalances', () => {
    it('opening + income - expenses - transfers out + transfers in', () => {
        const txs = [
            tx({ accountId: 'rev', total: 100 }), // expense -100
            tx({ accountId: 'rev', total: 2000, transactionType: 'income' }), // +2000
            tx({ accountId: 'rev', toAccountId: 'sav', total: 300, transactionType: 'transfer' }),
            tx({ accountId: 'sav', toAccountId: 'rev', total: 50, transactionType: 'transfer' }),
            tx({ accountId: 'cash', total: 12.34 }),
        ]
        const b = Object.fromEntries(accountBalances(accounts, txs).map((a) => [a.id, a.balance]))
        expect(b.rev).toBe(500 - 100 + 2000 - 300 + 50)
        expect(b.sav).toBe(1000 + 300 - 50)
        expect(b.cash).toBe(-12.34)
        expect(b.inv).toBe(0)
    })

    it('ignores transactions before the opening date, without account, and planned/unpaid ones', () => {
        const txs = [
            tx({ accountId: 'rev', total: 999, date: '2025-12-31' }),
            tx({ total: 50 }),
            tx({ accountId: 'rev', total: 70, trackingData: { isTracked: true, status: 'open' } }),
            tx({ accountId: 'rev', total: 5, trackingData: { isTracked: true, status: 'done' } }),
        ]
        expect(accountBalances(accounts, txs)[0].balance).toBe(495)
    })

    it('keeps account order and metadata, and rounds', () => {
        const out = accountBalances(accounts, [tx({ accountId: 'rev', total: 0.1 }), tx({ accountId: 'rev', total: 0.2 })])
        expect(out.map((a) => a.id)).toEqual(['rev', 'cash', 'sav', 'inv'])
        expect(out[0]).toMatchObject({ name: 'Revolut', kind: 'spending', currency: 'EUR', balance: 499.7 })
    })

    it('handles a transfer to an unknown account and empty input', () => {
        expect(accountBalances([], [tx({ accountId: 'x' })])).toEqual([])
        const b = accountBalances(accounts, [tx({ accountId: 'rev', toAccountId: 'gone', total: 10, transactionType: 'transfer' })])
        expect(b[0].balance).toBe(490)
    })

    it('uses amountBase when the account currency equals the base currency and the tx currency differs', () => {
        const usd = tx({ accountId: 'rev', total: 100, currency: 'USD', amountBase: 92, baseCurrency: 'EUR' })
        expect(accountBalances(accounts, [usd])[0].balance).toBe(500 - 92)
    })

    it('totalBalance filters by kind, currency and archived', () => {
        const b = accountBalances([...accounts, { id: 'old', name: 'Old', kind: 'spending', currency: 'EUR', openingBalance: 5, isArchived: true }], [])
        expect(totalBalance(b)).toBe(1500)
        expect(totalBalance(b, { kinds: ['savings', 'investment'] })).toBe(1000)
        expect(totalBalance(b, { currency: 'USD' })).toBe(0)
    })
})

describe('monthTotals', () => {
    const trips = [{ id: 'trip1', name: 'Japan', kind: 'trip', excludeFromBudgets: true }, { id: 'trip2', name: 'Weekend', kind: 'trip', excludeFromBudgets: false }]

    it('splits spent, income, saved, savingsRate for the month only', () => {
        const txs = [
            tx({ total: 100, accountId: 'rev' }),
            tx({ total: 50, category: 'Dining' }),
            tx({ total: 2000, transactionType: 'income' }),
            tx({ transactionType: 'transfer', accountId: 'rev', toAccountId: 'sav', total: 300 }),
            tx({ transactionType: 'transfer', accountId: 'rev', toAccountId: 'inv', total: 100 }),
            tx({ transactionType: 'transfer', accountId: 'sav', toAccountId: 'rev', total: 50 }),
            tx({ transactionType: 'transfer', accountId: 'rev', toAccountId: 'cash', total: 80 }),
            tx({ total: 999, date: '2026-10-31' }),
            tx({ total: 999, date: '2026-12-01' }),
        ]
        const t = monthTotals(txs, '2026-11', { accounts })
        expect(t.spent).toBe(150) // transfers excluded
        expect(t.income).toBe(2000)
        expect(t.saved).toBe(300 + 100 - 50) // into savings/investment minus out; rev->cash neutral
        expect(t.savingsRate).toBe(0.18)
        expect(t.upcoming).toBe(0)
        expect(t.travel).toBe(0)
    })

    it('savings rate is null when there is no income; transfers between savings accounts are neutral', () => {
        const t = monthTotals([tx({ transactionType: 'transfer', accountId: 'sav', toAccountId: 'inv', total: 200 })], '2026-11', { accounts })
        expect(t.saved).toBe(0)
        expect(t.savingsRate).toBeNull()
    })

    it('without accounts, a transfer with a goal counts as saved', () => {
        const t = monthTotals([tx({ transactionType: 'transfer', accountId: 'rev', total: 40, goalId: 'g1' }), tx({ transactionType: 'transfer', accountId: 'rev', total: 70 })], '2026-11')
        expect(t.saved).toBe(40)
    })

    it('trip expenses with excludeFromBudgets are reported under travel and also inside spent', () => {
        const txs = [
            tx({ total: 100 }),
            tx({ total: 60, groupId: 'trip1' }),
            tx({ total: 40, groupId: 'trip1', category: 'Dining' }),
            tx({ total: 25, groupId: 'trip2' }), // trip that is NOT excluded
        ]
        const t = monthTotals(txs, '2026-11', { trips })
        expect(t.spent).toBe(225)
        expect(t.travel).toBe(100)
        expect(t.travelByTrip).toEqual([{ tripId: 'trip1', name: 'Japan', total: 100 }])
    })

    it('planned items are upcoming, not spent; done ones count', () => {
        const txs = [
            tx({ total: 80, trackingData: { isTracked: true, status: 'open' } }),
            tx({ total: 20, trackingData: { isTracked: true, status: 'done' } }),
        ]
        const t = monthTotals(txs, '2026-11')
        expect(t.upcoming).toBe(80)
        expect(t.spent).toBe(20)
    })

    it('uses amountBase and the split share', () => {
        const txs = [tx({ total: 100, amountBase: 90, splitData: { method: 'equal', people: 2 } }), tx({ total: 10, currency: 'USD', amountBase: 9.2 })]
        expect(monthTotals(txs, '2026-11').spent).toBe(54.2)
    })

    it('empty input', () => {
        expect(monthTotals([], '2026-11')).toMatchObject({ spent: 0, income: 0, saved: 0, savingsRate: null, upcoming: 0, travel: 0 })
        expect(monthTotals(undefined, '2026-11').spent).toBe(0)
    })
})

describe('spentByCategory / excludedTripIds', () => {
    it('groups by category and can leave trip spend out', () => {
        const txs = [tx({ total: 10 }), tx({ total: 5, groupId: 'trip1' }), tx({ total: 7, category: 'Dining' }), tx({ total: 3, category: undefined })]
        const trips = [{ id: 'trip1', kind: 'trip' }]
        expect(spentByCategory(txs, '2026-11', { trips })).toEqual({ Groceries: 15, Dining: 7, Other: 3 })
        expect(spentByCategory(txs, '2026-11', { trips, includeTrips: false })).toEqual({ Groceries: 10, Dining: 7, Other: 3 })
    })
    it('excludedTripIds respects the flag (default true) and kind', () => {
        const ids = excludedTripIds([{ id: 'a', kind: 'trip' }, { id: 'b', kind: 'trip', excludeFromBudgets: false }, { id: 'c', kind: 'project' }])
        expect([...ids]).toEqual(['a'])
    })
})

describe('cumulativeSpend', () => {
    const e = (date, total, extra = {}) => ({ id: date + total, date, total, transactionType: 'expense', ...extra });
    it('runs a cumulative total per day, skipping planned and other months', () => {
        const txs = [e('2026-11-01', 10), e('2026-11-03', 5), e('2026-11-03', 5), e('2026-10-31', 99), e('2026-11-02', 50, { trackingData: { isTracked: true, status: 'open' } })];
        expect(cumulativeSpend(txs, '2026-11', { upToDay: 4 })).toEqual([10, 10, 20, 20]);
        expect(cumulativeSpend(txs, '2026-11')).toHaveLength(30);
    });
});
