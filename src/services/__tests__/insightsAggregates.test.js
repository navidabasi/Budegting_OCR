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
        expect(Object.keys(agg).sort()).toEqual(['budgets', 'categoriesByMonth', 'currency', 'dayOfMonth', 'daysInMonth', 'dismissed', 'findings', 'goals', 'month', 'monthState', 'opportunities', 'patterns', 'period', 'recurring', 'savingsSeries', 'summary', 'topMerchants', 'trips', 'verdict', 'version'])
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
        expect(text).not.toMatch(/"(notes|lineItems|description|merchantRaw|accountId|txId|evidence)"/)
        // the only ids are the short handles the app gives its own findings and suggestions (N1, O1): never a record id
        for (const m of text.matchAll(/"id":"([^"]*)"/g)) expect(m[1]).toMatch(/^[NO]\d{1,2}$/)
    })

    it('is JSON-safe and deterministic', () => {
        expect(JSON.parse(JSON.stringify(agg))).toEqual(agg)
        expect(stableStringify(buildAggregates(input))).toBe(stableStringify(agg))
        expect(stableStringify(buildAggregates({ ...input, transactions: [...transactions].reverse() }))).toBe(stableStringify(agg))
    })

    it('includes the engine findings (id, type, severity, text and their figures only)', () => {
        const withBudget = buildAggregates({ ...input, budgets: [{ id: 'b', category: 'Groceries', amount: 40, startsOn: '2026-11-01' }] })
        const over = withBudget.findings.find((f) => f.type === 'budget_over')
        expect(over).toBeTruthy()
        expect(Object.keys(over).sort()).toEqual(['amount', 'body', 'category', 'figures', 'id', 'merchant', 'severity', 'title', 'type'])
        expect(over.id).toMatch(/^N\d+$/)
        expect(Object.values(over.figures).every((v) => typeof v === 'number')).toBe(true)
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

describe('buildAggregates on a pay cycle', () => {
    it('aggregates the cycle (not the calendar month), keys the series by cycle and states the exact dates', async () => {
        const { cyclePeriod } = await import('../../utils/payCycle')
        const cfg = { rules: [{ from: '0000-01', payday: 12, weekendRule: 'none' }] }
        const cycle = cyclePeriod('2026-10', cfg) // 12 Oct - 11 Nov
        const txs = [
            { id: 'a', transactionType: 'expense', merchant: 'Lidl', total: 30, currency: 'EUR', date: '2026-10-20', category: 'Groceries' },
            { id: 'b', transactionType: 'expense', merchant: 'Lidl', total: 20, currency: 'EUR', date: '2026-11-05', category: 'Groceries' },
            { id: 'c', transactionType: 'expense', merchant: 'Lidl', total: 99, currency: 'EUR', date: '2026-11-12', category: 'Groceries' }, // next cycle
        ]
        const agg = buildAggregates({ transactions: txs, month: cycle, today: '2026-11-02' })
        expect(agg.period).toEqual({ kind: 'cycle', start: '2026-10-12', end: '2026-11-11' })
        expect(agg.month).toBe('2026-10')
        expect(agg.summary.spent).toBe(50)
        expect(agg.dayOfMonth).toBe(22)
        expect(agg.daysInMonth).toBe(31)
        expect(agg.categoriesByMonth['2026-10']).toEqual({ Groceries: 50 })
        expect(Object.keys(agg.categoriesByMonth)).toHaveLength(12)
        expect(agg.findings.every((f) => !f.link || String(f.link.params.m).startsWith('c:'))).toBe(true)
    })
})

// ---- pass 3 (A4): what the model receives ---------------------------------------------------
import { verdictFigures, buildRefMap, MAX_FINDINGS_SENT } from '../insightsAggregates'
import { computeOpportunities } from '../savingsOpportunities'
import { computeInsights as engine } from '../insightsEngine'
import { ownerLike, TODAY } from '../__fixtures__/ownerLike'
import { currentCyclePeriod, normalizeConfig } from '../../utils/payCycle'

describe('aggregates v2 (owner-like data)', () => {
    const d = ownerLike()
    const period = currentCyclePeriod(normalizeConfig(d.config), new Date(`${TODAY}T12:00:00Z`))
    const opp = computeOpportunities({ ...d, period, dismissed: { 'subscription_review:spotify': '2026-11-01' } })
    const agg = buildAggregates({ ...d, month: period, opportunities: opp.top, dismissed: opp.dismissed })
    it('carries the cards as numbers and names under short ids, and what was dismissed', () => {
        expect(agg.version).toBe(2)
        expect(agg.opportunities.map((o) => o.id)).toEqual(opp.top.map((_, i) => `O${i + 1}`))
        expect(agg.opportunities[0]).toMatchObject({ oppKind: 'category_above_baseline', category: 'Dining', monthlySaving: 79, yearlySaving: 948, confidence: 'high', action: 'set_budget', current: 100.5, baseline: 21.5 })
        expect(agg.dismissed).toEqual([{ oppKind: 'subscription_review', category: 'Subscriptions', merchant: 'Spotify' }])
        expect(agg.findings.length).toBeLessThanOrEqual(MAX_FINDINGS_SENT)
        const text = JSON.stringify(agg)
        for (const t of d.transactions) expect(text.includes(`"${t.id}"`)).toBe(false)
        expect(text.length).toBeLessThan(40 * 1024)
    })
    it('verdict figures compare the same elapsed days while the period runs', () => {
        const v = verdictFigures({ ...d, period })
        expect(v).toMatchObject({ basis: 'elapsed', elapsedDays: 17, totalDays: 31, daysLeft: 15, safeBasis: 'income' })
        const sum = (start, end) => d.transactions.filter((t) => t.transactionType === 'expense' && !t.trackingData && t.date >= start && t.date <= end).reduce((s, t) => s + (t.splitData ? t.total / 2 : t.total), 0)
        expect(v.spent).toBeCloseTo(sum('2026-10-27', '2026-11-12'), 1)
        expect(v.spentBefore).toBeCloseTo(sum('2026-09-27', '2026-10-13'), 1) // not the whole previous cycle
        expect(v.change).toBeCloseTo(v.spent - v.spentBefore, 1)
        expect(v.safePerDay).toBeGreaterThan(0)
    })
    it('a closed period compares whole periods; the first period on record has nothing to compare with', () => {
        const closed = verdictFigures({ ...d, period: '2026-09', today: TODAY })
        expect(closed).toMatchObject({ basis: 'completed', safePerDay: null, daysLeft: 0 })
        expect(closed.spentBefore).toBeGreaterThan(0)
        expect(verdictFigures({ ...d, period: '2025-12', today: TODAY }).spentBefore).toBeNull()
    })
    it('the whole-period budget decides what is safe to spend when there is one', () => {
        const budgets = [{ id: 'w', category: '*', amount: 1200, currency: 'EUR', startsOn: '2026-01-01' }]
        const v = verdictFigures({ ...d, budgets, period })
        expect(v.safeBasis).toBe('budget')
        expect(v.safePerDay).toBeCloseTo((1200 - monthTotalsSpent(d, period)) / 15, 1)
    })
    it('the ref map gives every id sent the finding or suggestion it stands for (kept on the device)', () => {
        const findings = engine({ ...d, month: period })
        const map = buildRefMap(findings, opp.top)
        expect(map.O1).toBe('category_above_baseline:Dining')
        expect(map.N1).toBe(findings[0].id)
        expect(Object.keys(map)).toHaveLength(Math.min(findings.length, MAX_FINDINGS_SENT) + opp.top.length)
        expect(agg.findings.map((f) => f.type)).toEqual(findings.slice(0, MAX_FINDINGS_SENT).map((f) => f.type))
    })
})
import { monthTotals } from '../../utils/money'
const monthTotalsSpent = (d, period) => {
    const t = monthTotals(d.transactions, period, { trips: d.trips, accounts: d.accounts })
    return t.spent + t.upcoming
}

import { buildAggregates as buildAgg2, hashAggregates as hash2 } from '../insightsAggregates';
import { computePatterns as patterns2 } from '../patternInsights';
import { ownerLike as owner2, TODAY as TODAY2 } from '../__fixtures__/ownerLike';
import { currentCyclePeriod as cycle2, normalizeConfig as norm2 } from '../../utils/payCycle';
describe('B-T4: the top patterns go into the aggregates, under the size cap', () => {
    const d = owner2();
    const period = cycle2(norm2(d.config), new Date(`${TODAY2}T12:00:00Z`));
    const top = patterns2({ ...d, period }).top;
    const agg2 = buildAgg2({ ...d, month: period, today: TODAY2, patterns: top });
    it('adds P-ids, kinds and figures, no record ids', () => {
        expect(agg2.patterns).toEqual([expect.objectContaining({ id: 'P1', patternKind: 'merchant_cadence', merchant: 'Tabaccheria Centrale', everyDays: 5.9 })]);
        expect(JSON.stringify(agg2.patterns)).not.toMatch(/"s\d+"/);
        expect(Buffer.byteLength(JSON.stringify(agg2))).toBeLessThan(120 * 1024);
        expect(hash2(agg2)).not.toBe(hash2({ ...agg2, patterns: [] }));
    });
});
