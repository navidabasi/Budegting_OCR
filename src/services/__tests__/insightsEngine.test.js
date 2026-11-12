import { describe, it, expect } from 'vitest'
import { computeInsights, detectSubscriptions, THRESHOLDS } from '../insightsEngine'

let n = 0
const tx = (o) => ({ id: `t${++n}`, date: '2026-11-05', total: 10, currency: 'EUR', category: 'Dining', merchant: 'Some shop', transactionType: 'expense', ...o })
const many = (count, o, dates) => Array.from({ length: count }, (_, i) => tx({ ...o, date: dates[i % dates.length] }))
const of = (findings, type) => findings.filter((f) => f.type === type)
const run = (txs, extra = {}) => computeInsights({ transactions: txs, month: '2026-11', today: '2026-11-20', ...extra })

describe('category change vs 3-month average', () => {
    const history = (amount) => [
        tx({ category: 'Dining', total: amount, date: '2026-08-10' }),
        tx({ category: 'Dining', total: amount, date: '2026-09-10' }),
        tx({ category: 'Dining', total: amount, date: '2026-10-10' }),
    ]
    it('flags an increase of >= 25 % and >= 20 EUR', () => {
        const f = of(run([...history(100), tx({ category: 'Dining', total: 130 })]), 'category_up')
        expect(f).toHaveLength(1)
        expect(f[0]).toMatchObject({ category: 'Dining', severity: 'medium', amount: 30, i18nKey: 'insight.category_up' })
        expect(f[0].params).toMatchObject({ pct: 30, average: 100, current: 130 })
        expect(f[0].link).toEqual({ screen: 'activity', params: { m: '2026-11', category: 'Dining' } })
    })
    it('is high severity at +50 % and +50 EUR', () => {
        expect(of(run([...history(100), tx({ total: 150 })]), 'category_up')[0].severity).toBe('high')
    })
    it('ignores small percentages or small amounts', () => {
        expect(of(run([...history(100), tx({ total: 120 })]), 'category_up')).toHaveLength(0) // +20 %
        expect(of(run([...history(40), tx({ total: 54 })]), 'category_up')).toHaveLength(0) // +35 % but only 14
        expect(of(run([...history(40), tx({ total: 60 })]), 'category_up')).toHaveLength(1) // +50 %, 20 exactly
    })
    it('needs history for the category', () => {
        expect(of(run([tx({ total: 500 })]), 'category_up')).toHaveLength(0)
    })
    it('ignores trip spend', () => {
        const trips = [{ id: 'tr', kind: 'trip', excludeFromBudgets: true }]
        expect(of(run([...history(100), tx({ total: 500, groupId: 'tr' })], { trips }), 'category_up')).toHaveLength(0)
    })
    it('reports a decrease as a positive finding only once the month is over', () => {
        const base = [tx({ category: 'Groceries', total: 400, date: '2026-07-10' }), tx({ category: 'Groceries', total: 400, date: '2026-08-10' }), tx({ category: 'Groceries', total: 400, date: '2026-09-10' }), tx({ category: 'Groceries', total: 250, date: '2026-10-10' })]
        const past = computeInsights({ transactions: base, month: '2026-10', today: '2026-11-20' })
        const down = of(past, 'category_down')
        expect(down).toHaveLength(1)
        expect(down[0]).toMatchObject({ severity: 'positive', amount: 150 })
        // same drop in the running month is just a partial month: no finding
        const current = computeInsights({ transactions: [...base.slice(0, 3), tx({ category: 'Groceries', total: 50, date: '2026-10-10' }), tx({ category: 'Groceries', total: 40 })].map((t, i) => (i === 3 ? { ...t, date: '2026-07-11' } : t)), month: '2026-11', today: '2026-11-20' })
        expect(of(current, 'category_down')).toHaveLength(0)
    })
})

describe('budget pace', () => {
    const budgets = [{ id: 'b', category: 'Dining', amount: 100, currency: 'EUR', startsOn: '2026-11-01' }]
    it('over budget -> high', () => {
        const f = of(run([tx({ total: 120 })], { budgets }), 'budget_over')
        expect(f).toHaveLength(1)
        expect(f[0]).toMatchObject({ severity: 'high', amount: 20, category: 'Dining' })
    })
    it('projection above budget -> medium with a per-day hint', () => {
        const f = of(run([tx({ total: 80 })], { budgets }), 'budget_pace')
        expect(f).toHaveLength(1)
        expect(f[0].severity).toBe('medium')
        expect(f[0].amount).toBe(20) // 80 / 20 days * 30 = 120
        expect(f[0].params.perDay).toBeCloseTo(20 / 11, 2)
    })
    it('on track -> nothing; whole-month budget uses a friendly label', () => {
        expect(of(run([tx({ total: 30 })], { budgets }), 'budget_pace')).toHaveLength(0)
        const w = [{ id: 'w', category: '*', amount: 100, startsOn: '2026-11-01' }]
        const f = of(run([tx({ total: 150 })], { budgets: w }), 'budget_over')
        expect(f[0].title).toBe('€50 over budget: Whole month')
        expect(f[0].category).toBeNull()
    })
    it('no pace warning for a closed month, but over is still reported', () => {
        const past = computeInsights({ transactions: [tx({ total: 95, date: '2026-10-10' })], budgets: [{ id: 'b', category: 'Dining', amount: 100, startsOn: '2026-10-01' }], month: '2026-10', today: '2026-11-20' })
        expect(of(past, 'budget_pace')).toHaveLength(0)
        const over = computeInsights({ transactions: [tx({ total: 105, date: '2026-10-10' })], budgets: [{ id: 'b', category: 'Dining', amount: 100, startsOn: '2026-10-01' }], month: '2026-10', today: '2026-11-20' })
        expect(of(over, 'budget_over')).toHaveLength(1)
    })
})

describe('unusual transaction (> mean + 2 sigma, >= 5 samples)', () => {
    const samples = (amounts) => amounts.map((a, i) => tx({ category: 'Groceries', total: a, date: i % 2 ? '2026-09-12' : '2026-10-12' }))
    it('flags a payment far above the category norm', () => {
        const f = of(run([...samples([20, 22, 18, 21, 19, 23]), tx({ category: 'Groceries', total: 200, merchant: 'Lidl' })]), 'unusual_transaction')
        expect(f).toHaveLength(1)
        expect(f[0]).toMatchObject({ amount: 200, category: 'Groceries', severity: 'medium', merchant: 'lidl' })
        expect(f[0].link.screen).toBe('transaction')
    })
    it('needs at least 5 samples', () => {
        expect(of(run([...samples([20, 22, 18, 21]), tx({ category: 'Groceries', total: 200 })]), 'unusual_transaction')).toHaveLength(0)
    })
    it('threshold is strictly above mean + 2 sigma', () => {
        const wide = samples([10, 30, 10, 30, 10, 30]) // mean 20, sd 10 -> limit 40
        expect(of(run([...wide, tx({ category: 'Groceries', total: 40 })]), 'unusual_transaction')).toHaveLength(0)
        expect(of(run([...wide, tx({ category: 'Groceries', total: 41 })]), 'unusual_transaction')).toHaveLength(1)
    })
    it('ignores small deviations when all samples are identical', () => {
        expect(of(run([...samples([20, 20, 20, 20, 20, 20]), tx({ category: 'Groceries', total: 25 })]), 'unusual_transaction')).toHaveLength(0)
    })
    it('reports at most three, largest first', () => {
        const big = [200, 300, 400, 500].map((a) => tx({ category: 'Groceries', total: a }))
        const f = of(run([...samples([20, 22, 18, 21, 19, 23]), ...big]), 'unusual_transaction')
        expect(f.map((x) => x.amount)).toEqual([500, 400, 300])
    })
})

describe('subscriptions', () => {
    const netflix = (dates, amount = 12.99, o = {}) => dates.map((d) => tx({ merchant: 'NETFLIX.COM', category: 'Entertainment', total: amount, date: d, ...o }))
    it('detects same merchant and amount about 30 days apart, >= 2 times', () => {
        const f = of(run(netflix(['2026-09-04', '2026-10-04'])), 'subscription')
        expect(f).toHaveLength(1)
        expect(f[0]).toMatchObject({ merchant: 'netflix', amount: 12.99, severity: 'low' })
        expect(f[0].params).toMatchObject({ count: 2, yearly: 155.88 })
    })
    it('tolerates +-5 % in the amount and 27-33 day gaps', () => {
        expect(of(run(netflix(['2026-09-04'], 12.99).concat(netflix(['2026-10-06'], 13.5))), 'subscription')).toHaveLength(1) // +3.9 %, 32 days
        expect(of(run(netflix(['2026-09-04'], 12.99).concat(netflix(['2026-10-04'], 14))), 'subscription')).toHaveLength(0) // +7.8 %
        expect(of(run(netflix(['2026-09-10', '2026-10-05'])), 'subscription')).toHaveLength(0) // 25 days
        expect(of(run(netflix(['2026-09-01', '2026-10-05'])), 'subscription')).toHaveLength(0) // 34 days
    })
    it('needs two charges and skips ones already marked recurring', () => {
        expect(of(run(netflix(['2026-10-04'])), 'subscription')).toHaveLength(0)
        expect(of(run(netflix(['2026-09-04', '2026-10-04'], 12.99, { recurringData: { frequency: 'monthly' } })), 'subscription')).toHaveLength(0)
    })
    it('only reports charges that are still going on', () => {
        expect(of(run(netflix(['2026-04-04', '2026-05-04'])), 'subscription')).toHaveLength(0)
    })
    it('detectSubscriptions follows chains of three', () => {
        const chains = detectSubscriptions(netflix(['2026-08-04', '2026-09-03', '2026-10-03']))
        expect(chains).toHaveLength(1)
        expect(chains[0].count).toBe(3)
    })
})

describe('savings rate vs average', () => {
    const accounts = [{ id: 'cur', kind: 'spending' }, { id: 'sav', kind: 'savings' }]
    const month = (m, saved, income = 2000) => [
        tx({ transactionType: 'income', total: income, category: undefined, date: `${m}-01`, accountId: 'cur' }),
        tx({ transactionType: 'transfer', total: Math.abs(saved), date: `${m}-02`, accountId: saved >= 0 ? 'cur' : 'sav', toAccountId: saved >= 0 ? 'sav' : 'cur' }),
    ]
    const history = [...month('2026-08', 400), ...month('2026-09', 400), ...month('2026-10', 400)]
    const go = (saved, today = '2026-11-25') => computeInsights({ transactions: [...history, ...month('2026-11', saved)], accounts, month: '2026-11', today })

    it('flags a drop of >= 10 points', () => {
        const f = of(go(100), 'savings_rate_down')
        expect(f).toHaveLength(1)
        expect(f[0]).toMatchObject({ severity: 'medium', amount: 300 })
        expect(f[0].params).toMatchObject({ rate: 5, averageRate: 20 })
    })
    it('flags an improvement as positive', () => {
        const f = of(go(700), 'savings_rate_up')
        expect(f).toHaveLength(1)
        expect(f[0].severity).toBe('positive')
    })
    it('is high severity when money was taken out of savings', () => {
        expect(of(go(-200), 'savings_rate_down')[0].severity).toBe('high')
    })
    it('ignores small changes and the first 19 days of a running month', () => {
        expect(of(go(300), 'savings_rate_down')).toHaveLength(0) // 15 % vs 20 %
        expect(of(go(100, '2026-11-12'), 'savings_rate_down')).toHaveLength(0)
    })
    it('needs income and history', () => {
        expect(of(computeInsights({ transactions: month('2026-11', 100), accounts, month: '2026-11', today: '2026-11-25' }), 'savings_rate_down')).toHaveLength(0)
    })
})

describe('top merchant share > 30 %', () => {
    it('flags a dominant merchant', () => {
        const f = of(run([tx({ merchant: 'Esselunga S.p.A.', total: 200 }), tx({ merchant: 'Bar', total: 100 }), tx({ merchant: 'Edison', total: 100 })]), 'top_merchant')
        expect(f).toHaveLength(1)
        expect(f[0]).toMatchObject({ merchant: 'esselunga', amount: 200 })
        expect(f[0].title).toBe('50% of spending went to Esselunga')
    })
    it('is exclusive at exactly 30 % and ignores tiny months', () => {
        expect(of(run([tx({ merchant: 'Lidl', total: 30 }), tx({ merchant: 'Coop', total: 25 }), tx({ merchant: 'Edison', total: 25 }), tx({ merchant: 'Conad', total: 20 })]), 'top_merchant')).toHaveLength(0) // total 100, top 30 %
        expect(of(run([tx({ merchant: 'Lidl', total: 50 }), tx({ merchant: 'Bar', total: 10 })]), 'top_merchant')).toHaveLength(0) // total < 100
    })
})

describe('no income logged', () => {
    it('flags spending without income', () => {
        const f = of(run([tx({ total: 150 })]), 'no_income')
        expect(f).toHaveLength(1)
        expect(f[0].amount).toBe(150)
    })
    it('not when income exists, spending is small or the month just started', () => {
        expect(of(run([tx({ total: 150 }), tx({ transactionType: 'income', total: 1 })]), 'no_income')).toHaveLength(0)
        expect(of(run([tx({ total: 50 })]), 'no_income')).toHaveLength(0)
        expect(of(computeInsights({ transactions: [tx({ total: 150, date: '2026-11-03' })], month: '2026-11', today: '2026-11-04' }), 'no_income')).toHaveLength(0)
    })
})

describe('uncategorised', () => {
    it('flags 5 or more uncategorised expenses (empty or Other)', () => {
        const txs = [...many(3, { category: 'Other' }, ['2026-11-02']), ...many(2, { category: undefined }, ['2026-11-03'])]
        const f = of(run(txs), 'uncategorised')
        expect(f).toHaveLength(1)
        expect(f[0].params.count).toBe(5)
        expect(f[0].link.params.category).toBe('uncategorised')
    })
    it('not for 4, and income does not count', () => {
        expect(of(run(many(4, { category: 'Other' }, ['2026-11-02'])), 'uncategorised')).toHaveLength(0)
        expect(of(run([...many(4, { category: 'Other' }, ['2026-11-02']), tx({ category: 'Other', transactionType: 'income' })]), 'uncategorised')).toHaveLength(0)
    })
})

describe('ordering and determinism', () => {
    const txs = [
        tx({ total: 120 }), tx({ total: 20, category: 'Other' }), ...many(5, { category: 'Other' }, ['2026-11-03']),
        tx({ category: 'Dining', total: 90, date: '2026-10-10' }), tx({ category: 'Dining', total: 90, date: '2026-09-10' }), tx({ category: 'Dining', total: 90, date: '2026-08-10' }),
    ]
    const budgets = [{ id: 'b', category: 'Dining', amount: 100, startsOn: '2026-11-01' }]

    it('severity first, then amount desc, then id', () => {
        const f = run(txs, { budgets })
        const rank = { high: 0, medium: 1, low: 2, positive: 3 }
        for (let i = 1; i < f.length; i++) {
            const a = f[i - 1]
            const b = f[i]
            expect(rank[a.severity]).toBeLessThanOrEqual(rank[b.severity])
            if (a.severity === b.severity) expect(a.amount ?? 0).toBeGreaterThanOrEqual(b.amount ?? 0)
        }
        expect(f[0].severity).toBe('high')
    })
    it('same result regardless of input order', () => {
        const a = run(txs, { budgets })
        const b = run([...txs].reverse(), { budgets })
        expect(b.map((f) => f.id)).toEqual(a.map((f) => f.id))
        expect(JSON.stringify(run(txs, { budgets }))).toBe(JSON.stringify(a))
    })
    it('every finding has the documented shape and unique ids', () => {
        const f = run(txs, { budgets })
        for (const x of f) {
            expect(Object.keys(x).sort()).toEqual(['amount', 'body', 'category', 'i18nKey', 'id', 'link', 'merchant', 'params', 'severity', 'title', 'type'])
        }
        expect(new Set(f.map((x) => x.id)).size).toBe(f.length)
    })
    it('empty input is fine; thresholds are exported', () => {
        expect(computeInsights({})).toEqual([])
        expect(run([])).toEqual([])
        expect(THRESHOLDS.categoryChangePct).toBe(0.25)
        expect(THRESHOLDS.topMerchantShare).toBe(0.3)
    })
})

// ---- pass 3 (A2) -----------------------------------------------------------------------
describe('fixed costs are not subscriptions', () => {
    const monthly = (merchant, category, total, o = {}) => ['2026-09-02', '2026-10-02', '2026-11-01'].map((date) => tx({ merchant, category, total, date, ...o }))
    it('rent is reported as a fixed cost with a link to all its payments', () => {
        const f = run(monthly('Rent', 'Housing', 380))
        expect(of(f, 'subscription')).toHaveLength(0)
        const [fixed] = of(f, 'fixed_cost')
        expect(fixed).toMatchObject({ severity: 'low', amount: 380, merchant: 'rent', i18nKey: 'insight.fixed_cost', title: '€380 a month for Rent' })
        expect(fixed.link).toEqual({ screen: 'activity', params: { m: 'all', merchant: 'rent' } })
    })
    it('utilities, insurance and rent filed under Other are fixed costs; Klarna and friend debts are not reported at all', () => {
        expect(of(run(monthly('Allianz', 'Insurance', 32)), 'fixed_cost')).toHaveLength(1)
        expect(of(run(monthly('Affitto', 'Other', 380)), 'fixed_cost')).toHaveLength(1)
        const debt = run([...monthly('Klarna', 'Shopping', 39.9), ...monthly('Marco', 'Debt', 50), ...monthly('Luca', 'Other', 20, { groupName: 'Debts' })])
        expect(of(debt, 'subscription')).toHaveLength(0)
        expect(of(debt, 'fixed_cost')).toHaveLength(0)
    })
    it('a real subscription still reads as one, number first', () => {
        const [s] = of(run(monthly('Spotify', 'Subscriptions', 11.99)), 'subscription')
        expect(s.title).toBe('€12 a month to Spotify')
        expect(s.params).toMatchObject({ count: 3, yearly: 143.88 })
    })
})

describe('fixed vs flexible', () => {
    it('reports the share of spending that is fixed', () => {
        const [f] = of(run([tx({ merchant: 'Rent', category: 'Housing', total: 380 }), tx({ merchant: 'Enel Energia', category: 'Utilities', total: 20 }), tx({ merchant: 'Klarna', category: 'Debt', total: 100 }), tx({ category: 'Dining', total: 300 })]), 'fixed_vs_flexible')
        expect(f.params).toEqual({ pct: 50, fixed: 400, flexible: 300, total: 800 })
        expect(f.link).toEqual({ screen: 'breakdown', params: { m: '2026-11' } })
    })
    it('nothing without fixed costs or for a tiny period', () => {
        expect(of(run([tx({ total: 500 })]), 'fixed_vs_flexible')).toHaveLength(0)
        expect(of(run([tx({ merchant: 'Rent', category: 'Housing', total: 50 })]), 'fixed_vs_flexible')).toHaveLength(0)
    })
})

describe('income vs spend', () => {
    const income = tx({ transactionType: 'income', category: 'Income', merchant: 'Salary', total: 1400, date: '2026-11-01' })
    it('running period: what is left and per day, counting unpaid bills', () => {
        const [f] = of(run([income, tx({ total: 600 }), tx({ total: 140, trackingData: { isTracked: true, status: 'open' } })]), 'income_vs_spend')
        expect(f.params).toEqual({ income: 1400, spent: 600, upcoming: 140, left: 660, days: 11, perDay: 60 })
        expect(f).toMatchObject({ severity: 'low', title: '€660 left for 11 days' })
    })
    it('more spent than came in: medium while running, high once the period is over', () => {
        expect(of(run([income, tx({ total: 1500 })]), 'income_vs_spend_over')[0]).toMatchObject({ severity: 'medium', amount: 100 })
        const closed = computeInsights({ transactions: [income, tx({ total: 1500 })], month: '2026-11', today: '2026-12-03' })
        expect(of(closed, 'income_vs_spend_over')[0].severity).toBe('high')
    })
    it('a finished period with money left is a win; no income, no finding', () => {
        const closed = computeInsights({ transactions: [income, tx({ total: 900 })], month: '2026-11', today: '2026-12-03' })
        expect(of(closed, 'income_vs_spend_done')[0]).toMatchObject({ severity: 'positive', amount: 500 })
        expect(run([tx({ total: 900 })]).filter((f) => f.type.startsWith('income_vs_spend'))).toHaveLength(0)
    })
})

describe('budget streak', () => {
    const budgets = [{ id: 'b', category: 'Dining', amount: 100, currency: 'EUR', startsOn: '2026-01-01' }]
    const months = (amounts) => amounts.map((total, i) => tx({ total, date: `2026-${String(11 - amounts.length + i).padStart(2, '0')}-10` }))
    it('a category under budget several periods in a row is a win', () => {
        const [f] = of(run([...months([150, 80, 90, 70]), tx({ total: 20 })], { budgets }), 'streak')
        expect(f).toMatchObject({ severity: 'positive', category: 'Dining', amount: 3 })
        expect(f.params).toMatchObject({ count: 3, budget: 100 })
    })
    it('one period is not a streak, and an overspent period breaks it', () => {
        expect(of(run([...months([150, 80])], { budgets }), 'streak')).toHaveLength(0)
        expect(of(run([...months([80, 90, 150])], { budgets }), 'streak')).toHaveLength(0)
    })
})

describe('weekend spike', () => {
    it('flags weekends that cost clearly more per day than weekdays', () => {
        // November 2026: 1, 7, 8, 14, 15 are weekend days up to the 20th
        const weekend = ['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15'].map((date) => tx({ total: 40, date }))
        const week = ['2026-11-03', '2026-11-10', '2026-11-17'].map((date) => tx({ total: 15, date }))
        const [f] = of(run([...weekend, ...week]), 'weekend_spike')
        expect(f.params).toEqual({ weekend: 32, weekday: 3, pct: 78, weekendDays: 5 })
    })
    it('not early in the period, not when rent falls on a Saturday', () => {
        expect(of(computeInsights({ transactions: [tx({ total: 200, date: '2026-11-07' })], month: '2026-11', today: '2026-11-09' }), 'weekend_spike')).toHaveLength(0)
        expect(of(run([tx({ merchant: 'Rent', category: 'Housing', total: 380, date: '2026-11-07' }), tx({ total: 30, date: '2026-11-10' })]), 'weekend_spike')).toHaveLength(0)
    })
})

describe('end of cycle squeeze', () => {
    const period = (m, late) => [...['03', '08', '13', '18', '22'].map((d) => tx({ total: 50, date: `2026-${m}-${d}` })), tx({ total: late, date: `2026-${m}-27` })]
    it('flags periods whose last week runs on less than half of the days before', () => {
        const [f] = of(run([...period('08', 10), ...period('09', 14), ...period('10', 200)]), 'end_of_cycle_squeeze')
        expect(f.params).toMatchObject({ count: 2, periods: 3 })
        expect(f.params.lastWeek).toBeLessThan(f.params.earlier / 2)
    })
    it('needs two such periods', () => {
        expect(of(run([...period('08', 10), ...period('09', 200), ...period('10', 200)]), 'end_of_cycle_squeeze')).toHaveLength(0)
    })
})
