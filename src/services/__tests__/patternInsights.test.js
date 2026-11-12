import { describe, expect, it } from 'vitest';
import { computePatterns, toModelPatterns } from '../patternInsights';
import { ownerLike, ownerLikeTransactions, TODAY } from '../__fixtures__/ownerLike';
import { currentCyclePeriod, monthPeriod, normalizeConfig } from '../../utils/payCycle';
import { addDays } from '../../utils/monthMath';

const d = ownerLike();
const cycle = currentCyclePeriod(normalizeConfig(d.config), new Date(`${TODAY}T12:00:00Z`));
let n = 0;
const ex = (date, merchant, total, category) => ({ id: `h${++n}`, userId: 'u', merchant, total, currency: 'EUR', category, date, lineItems: [], transactionType: 'expense', accountId: 'a-main', createdAt: `${date}T10:00:00Z` });

/** The owner-like record plus clear habits: weekend bar evenings, a shopping spree after payday, a rising hobby, many small buys now. */
function withHabits() {
    n = 0;
    const extra = [];
    for (let day = '2026-04-04'; day <= TODAY; day = addDays(day, 7)) extra.push(ex(day, 'Bar Sport', 25, 'Dining'), ex(addDays(day, 1), 'Bar Sport', 25, 'Dining'));
    for (const m of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) extra.push(ex(`${m}-28`, 'Zalando', 160, 'Shopping'));
    [['2026-06-28', 20], ['2026-07-28', 40], ['2026-08-28', 60], ['2026-09-28', 80]].forEach(([date, amount]) => extra.push(ex(date, 'Padel Club', amount, 'Entertainment')));
    for (let k = 0; k < 12; k += 1) extra.push(ex(addDays('2026-10-28', k), 'Edicola', 3.5, 'Shopping'));
    return [...ownerLikeTransactions(), ...extra];
}
const run = (extra = {}) => computePatterns({ ...d, period: cycle, ...extra });
const byKind = (rows, kind) => rows.filter((r) => r.kind === kind);

describe('B-T1 pattern detectors', () => {
    it('owner-like data: only the true habit (the tobacconist about every 6 days), nothing invented', () => {
        const { all } = run();
        expect(all.map((r) => r.kind)).toEqual(['merchant_cadence']);
        expect(all[0]).toMatchObject({ key: 'pattern_merchant_cadence:tabaccheria centrale', severity: 'info', filter: { merchant: 'Tabaccheria Centrale' } });
        expect(all[0].params).toMatchObject({ merchant: 'Tabaccheria Centrale', visits: 34, everyDays: 5.9, perVisit: 5.91 });
        expect(all[0].scope).toEqual({ start: '2026-04-27', end: TODAY });
        expect(all[0].evidence.length).toBeGreaterThan(0);
        // stable: same input, same output
        expect(run()).toEqual(run());
    });

    it('finds weekend, small-purchase, streak and payday habits with the figures behind them', () => {
        const { all, top } = run({ transactions: withHabits() });
        const kinds = all.map((r) => r.kind);
        expect(kinds).toEqual(expect.arrayContaining(['weekend_heavy', 'small_purchases', 'category_streak', 'payday_effect', 'merchant_cadence']));
        const we = byKind(all, 'weekend_heavy')[0].params;
        expect(we.weekendPerDay).toBeGreaterThan(we.weekdayPerDay * 1.5);
        const small = byKind(all, 'small_purchases')[0];
        expect(small.params).toMatchObject({ under: 10 });
        expect(small.params.count).toBeGreaterThanOrEqual(12);
        expect(small.params.total).toBeGreaterThan(small.params.baselineTotal);
        expect(small.scope).toEqual({ start: '2026-10-27', end: TODAY });
        const streak = byKind(all, 'category_streak').find((r) => r.params.category === 'Entertainment');
        expect(streak.params).toMatchObject({ category: 'Entertainment', direction: 'up', periods: 4, first: 20, last: 80, change: 60, amounts: [20, 40, 60, 80] });
        const pay = byKind(all, 'payday_effect')[0].params;
        expect(pay.paydays).toBeGreaterThanOrEqual(3);
        expect(pay.perDayAfter).toBeGreaterThan(pay.perDayOther * 1.6);
        // the cards show at most 4, "watch" before "info"
        expect(top.length).toBeLessThanOrEqual(4);
        expect(top[0].severity).toBe('watch');
    });

    it('no detector fires with fewer than 3 earlier periods of data, or in the first days of a running period', () => {
        const recent = withHabits().filter((t) => t.date >= '2026-09-01');
        expect(run({ transactions: recent }).all).toEqual([]);
        const early = currentCyclePeriod(normalizeConfig(d.config), new Date('2026-10-29T12:00:00Z'));
        expect(computePatterns({ ...d, transactions: withHabits(), period: early, today: '2026-10-29' }).all).toEqual([]);
    });

    it('works on calendar months too and leaves fixed costs, transfers, planned bills and income out', () => {
        const { all } = computePatterns({ ...d, transactions: withHabits(), period: monthPeriod('2026-10') });
        expect(all.length).toBeGreaterThan(0);
        const ids = new Set(all.flatMap((r) => r.evidence));
        const txs = new Map(withHabits().map((t) => [t.id, t]));
        for (const id of ids) {
            const t = txs.get(id);
            expect(t.transactionType).toBe('expense');
            expect(['Housing', 'Utilities', 'Insurance', 'Debt']).not.toContain(t.category);
        }
    });

    it('"Hide" uses the opportunity mechanism: hidden for 60 days, listed apart', () => {
        const key = 'pattern_merchant_cadence:tabaccheria centrale';
        const hidden = run({ dismissed: { [key]: '2026-11-01' } });
        expect(hidden.top).toEqual([]);
        expect(hidden.dismissed.map((r) => r.key)).toEqual([key]);
        expect(run({ dismissed: { [key]: '2026-08-01' } }).top.length).toBe(1);
    });

    it('toModelPatterns keeps kind, figures and dates, no record ids', () => {
        const [m] = toModelPatterns(run().top);
        expect(m).toMatchObject({ patternKind: 'merchant_cadence', merchant: 'Tabaccheria Centrale', periodStart: '2026-04-27', periodEnd: TODAY });
        expect(JSON.stringify(m)).not.toMatch(/"s\d+"/);
    });
});
