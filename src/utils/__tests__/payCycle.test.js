import { describe, expect, it } from 'vitest';
import { cycleForDate, cycleIdForDate, cycleRange, cycleStart, cyclePeriod, currentCycleId, describeCycle, nominalStart, normalizeConfig, periodFromSpec, periodSpec, previewConfigChange, suggestSalaryStart, todayInTimezone, validateOverride, withOverride, withRule, monthPeriod } from '../payCycle';
import { inPeriod, previousPeriods, periodKey, comparablePeriods } from '../period';
import { monthTotals } from '../money';

const cfg = (payday, weekendRule = 'none', extra = {}) => ({ rules: [{ from: '0000-01', payday, weekendRule }], overrides: [], ...extra });

describe('boundary rule: a cycle starts on payday (inclusive), the purchase date decides', () => {
    const c = cfg(12);
    it('the day before payday is the old cycle, payday itself starts the new one', () => {
        expect(cycleIdForDate('2026-11-11', c)).toBe('2026-10');
        expect(cycleIdForDate('2026-11-12', c)).toBe('2026-11');
        expect(cycleRange('2026-10', c)).toEqual({ id: '2026-10', start: '2026-10-12', end: '2026-11-11', days: 31 });
    });
    it('cycles tile the calendar: every date is in exactly one cycle, across year ends', () => {
        const seen = new Set();
        for (let d = new Date(Date.UTC(2025, 10, 1)); d < new Date(Date.UTC(2027, 1, 1)); d = new Date(d.getTime() + 86400000)) {
            const key = d.toISOString().slice(0, 10);
            const id = cycleIdForDate(key, c);
            const r = cycleRange(id, c);
            expect(key >= r.start && key <= r.end).toBe(true);
            seen.add(id);
        }
        expect(seen.size).toBe(16); // 2025-10 .. 2027-01
        expect(cycleIdForDate('2026-01-05', c)).toBe('2025-12');
        expect(cycleRange('2025-12', c).end).toBe('2026-01-11');
    });
    it('uses the purchase date, never the scan or sync date', () => {
        // a purchase from 10 Nov that is scanned and synced on 20 Nov still belongs to the cycle that was running on 10 Nov
        const tx = { id: 'x', date: '2026-11-10', total: 30, createdAt: '2026-11-20T09:00:00Z', updatedAt: '2026-11-20T09:05:00Z', transactionType: 'expense' };
        expect(cycleIdForDate(tx.date, c)).toBe('2026-10');
        const oct = cyclePeriod('2026-10', c);
        const nov = cyclePeriod('2026-11', c);
        expect(monthTotals([tx], oct).spent).toBe(30);
        expect(monthTotals([tx], nov).spent).toBe(0);
    });
});

describe('short months, February, leap years', () => {
    it('payday 31 falls on the last day of shorter months', () => {
        const c = cfg(31);
        expect(cycleStart('2026-02', c)).toBe('2026-02-28');
        expect(cycleStart('2028-02', c)).toBe('2028-02-29'); // leap year
        expect(cycleStart('2026-04', c)).toBe('2026-04-30');
        expect(cycleRange('2026-02', c)).toMatchObject({ start: '2026-02-28', end: '2026-03-30' });
        expect(cycleIdForDate('2026-03-30', c)).toBe('2026-02');
        expect(cycleIdForDate('2026-03-31', c)).toBe('2026-03');
        expect(cycleIdForDate('2026-02-27', c)).toBe('2026-01');
    });
    it('payday 30 in February', () => {
        expect(cycleStart('2026-02', cfg(30))).toBe('2026-02-28');
    });
    it('payday 1 is the calendar month', () => {
        const c = cfg(1);
        expect(cycleRange('2026-02', c)).toMatchObject({ start: '2026-02-01', end: '2026-02-28' });
        expect(cycleIdForDate('2026-11-30', c)).toBe('2026-11');
    });
});

describe('weekend rule: previous business day', () => {
    const c = cfg(15, 'previous');
    it('Saturday and Sunday paydays move to the Friday before', () => {
        expect(nominalStart('2026-08', { payday: 15, weekendRule: 'previous' })).toBe('2026-08-14'); // 15 Aug 2026 is a Saturday
        expect(nominalStart('2026-11', { payday: 15, weekendRule: 'previous' })).toBe('2026-11-13'); // Sunday
        expect(cycleStart('2026-12', c)).toBe('2026-12-15'); // Tuesday: unchanged
    });
    it('a Monday-1st payday on a Sunday starts in the previous month', () => {
        const c1 = cfg(1, 'previous');
        expect(cycleStart('2026-11', c1)).toBe('2026-10-30'); // 1 Nov 2026 is a Sunday
        expect(cycleIdForDate('2026-10-30', c1)).toBe('2026-11');
        expect(cycleIdForDate('2026-10-29', c1)).toBe('2026-10');
    });
    it('rule none keeps the weekend date', () => {
        expect(cycleStart('2026-08', cfg(15, 'none'))).toBe('2026-08-15');
    });
});

describe('case 6: early / late salary overrides and a late sync', () => {
    const base = cfg(12);
    it('a late salary moves the boundary: purchases on the days before it stay in the old cycle', () => {
        const late = withOverride(base, '2026-11', '2026-11-14');
        expect(cycleStart('2026-11', late)).toBe('2026-11-14');
        expect(cycleIdForDate('2026-11-13', late)).toBe('2026-10');
        expect(cycleIdForDate('2026-11-14', late)).toBe('2026-11');
        expect(cycleRange('2026-10', late).end).toBe('2026-11-13');
    });
    it('an early salary moves it earlier', () => {
        const early = withOverride(base, '2026-11', '2026-11-09');
        expect(cycleIdForDate('2026-11-09', early)).toBe('2026-11');
        expect(cycleIdForDate('2026-11-08', early)).toBe('2026-10');
    });
    it('right cycle after a late sync: an override saved afterwards re-buckets by purchase date, and stored dates never change', () => {
        const purchases = [
            { id: 'a', date: '2026-11-12', total: 40, transactionType: 'expense', createdAt: '2026-11-25T00:00:00Z' }, // synced 13 days late
            { id: 'b', date: '2026-11-13', total: 10, transactionType: 'expense', createdAt: '2026-11-25T00:00:00Z' },
            { id: 'c', date: '2026-11-14', total: 5, transactionType: 'expense', createdAt: '2026-11-14T00:00:00Z' },
        ];
        const before = cyclePeriod('2026-11', base);
        expect(monthTotals(purchases, before).spent).toBe(55);
        const late = withOverride(base, '2026-11', '2026-11-14'); // salary actually arrived on the 14th
        expect(monthTotals(purchases, cyclePeriod('2026-11', late)).spent).toBe(5);
        expect(monthTotals(purchases, cyclePeriod('2026-10', late)).spent).toBe(50);
        expect(purchases[0].date).toBe('2026-11-12');
    });
    it('rejects overrides that would cross a neighbouring cycle', () => {
        expect(validateOverride('2026-11', '2026-10-12', base)).toMatchObject({ ok: false });
        expect(validateOverride('2026-11', '2026-12-12', base)).toMatchObject({ ok: false });
        expect(validateOverride('2026-11', '2026-11-20', base)).toEqual({ ok: true });
        expect(() => withOverride(base, '2026-11', '2026-12-30')).toThrow();
        expect(cycleStart('2026-11', withOverride(withOverride(base, '2026-11', '2026-11-14'), '2026-11', null))).toBe('2026-11-12'); // clearing
    });
    it('suggests the start from the income that arrived near the payday', () => {
        const txs = [
            { id: 'i1', transactionType: 'income', date: '2026-11-14', total: 2350 },
            { id: 'i2', transactionType: 'income', date: '2026-11-13', total: 40 }, // not the salary
            { id: 'i3', transactionType: 'income', date: '2026-10-01', total: 9999 }, // outside the window
            { id: 'e1', transactionType: 'expense', date: '2026-11-12', total: 5000 },
        ];
        expect(suggestSalaryStart(txs, '2026-11', base)).toEqual({ date: '2026-11-14', amount: 2350, id: 'i1' });
        expect(suggestSalaryStart([], '2026-11', base)).toBeNull();
    });
});

describe('changing the payday never rewrites history without a preview', () => {
    it('a new rule effective from a later cycle leaves earlier cycles untouched', () => {
        const old = cfg(12);
        const changed = withRule(old, { payday: 27, from: '2026-12' });
        expect(cycleRange('2026-10', changed)).toEqual(cycleRange('2026-10', old));
        expect(cycleRange('2026-11', changed)).toMatchObject({ start: '2026-11-12', end: '2026-12-26' }); // 15 days longer: the transition cycle
        expect(cycleStart('2027-01', changed)).toBe('2027-01-27');
        // only dates after the transition move: 20 Dec was in cycle 2026-12 (from 12 Dec), it now falls in the longer 2026-11 cycle (to 26 Dec)
        expect(previewConfigChange([{ id: 'a', date: '2026-10-20' }, { id: 'b', date: '2026-11-20' }, { id: 'c', date: '2026-12-20' }], old, changed).map((m) => [m.id, m.from, m.to])).toEqual([['c', '2026-12', '2026-11']]);
    });
    it('applying to all history is previewed with the transactions that would move', () => {
        const old = cfg(12);
        const all = withRule(old, { payday: 27 });
        const moved = previewConfigChange([{ id: 'a', date: '2026-10-20' }, { id: 'b', date: '2026-10-28' }, { id: 'c', date: '2026-10-05' }], old, all);
        expect(moved.map((m) => [m.id, m.from, m.to])).toEqual([['a', '2026-10', '2026-09']]);
    });
    it('an unconfigured user keeps calendar months', () => {
        const n = normalizeConfig(null);
        expect(n.configured).toBe(false);
        expect(cycleRange('2026-11', n)).toMatchObject({ start: '2026-11-01', end: '2026-11-30' });
        expect(normalizeConfig({ rules: [{ payday: 99, weekendRule: 'bogus' }], timezone: 'Nope/Zone' })).toMatchObject({ timezone: 'Europe/Rome', rules: [{ payday: 31, weekendRule: 'none' }] });
    });
});

describe('timezone', () => {
    it('today is taken in the configured zone', () => {
        const instant = new Date('2026-11-11T23:30:00Z'); // already 12 Nov in Rome, still 11 Nov in New York
        expect(todayInTimezone('Europe/Rome', instant)).toBe('2026-11-12');
        expect(todayInTimezone('America/New_York', instant)).toBe('2026-11-11');
        expect(currentCycleId({ ...cfg(12), timezone: 'America/New_York' }, instant)).toBe('2026-10');
        expect(currentCycleId({ ...cfg(12), timezone: 'Europe/Rome' }, instant)).toBe('2026-11');
        expect(todayInTimezone('Not/AZone', instant)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe('period objects, specs and comparison basis', () => {
    const c = cfg(12);
    it('spec round trip', () => {
        const p = cyclePeriod('2026-10', c);
        expect(periodSpec(p)).toBe('c:2026-10');
        expect(periodFromSpec('c:2026-10', c)).toMatchObject({ kind: 'cycle', start: '2026-10-12', end: '2026-11-11' });
        expect(periodFromSpec('2026-11', c)).toMatchObject({ kind: 'month', start: '2026-11-01', end: '2026-11-30' });
        expect(periodFromSpec('r:2026-10-01..2026-10-20', c)).toMatchObject({ kind: 'range', days: 20 });
        expect(periodFromSpec('r:2026-10-20..2026-10-01', c)).toBeNull();
        expect(periodFromSpec('nonsense', c)).toBeNull();
        expect(periodKey(p)).toBe('2026-10');
    });
    it('previous periods are cycles for a cycle and months for a month', () => {
        expect(previousPeriods(cyclePeriod('2026-10', c), 2).map((p) => p.start)).toEqual(['2026-08-12', '2026-09-12']);
        expect(previousPeriods('2026-03', 2)).toEqual(['2026-01', '2026-02']);
        expect(previousPeriods(monthPeriod('2026-03'), 1)[0]).toMatchObject({ start: '2026-02-01', end: '2026-02-28' });
    });
    it('describes the active cycle with days left; compares completed with completed and active with the same elapsed days', () => {
        const active = cyclePeriod('2026-10', c); // 12 Oct - 11 Nov
        expect(describeCycle(active, '2026-11-02')).toMatchObject({ day: 22, days: 31, daysLeft: 10, state: 'current' });
        expect(describeCycle(active, '2026-11-11')).toMatchObject({ daysLeft: 1 });
        expect(describeCycle(active, '2026-11-12')).toMatchObject({ daysLeft: 0, state: 'past' });
        const prevOf = (r) => cycleRange('2026-09', c);
        const cmp = comparablePeriods(active, new Date(2026, 10, 2), prevOf);
        expect(cmp.basis).toBe('elapsed');
        expect(cmp.current).toEqual({ start: '2026-10-12', end: '2026-11-02' });
        expect(cmp.previous).toEqual({ start: '2026-09-12', end: '2026-10-03' });
        const done = comparablePeriods(active, new Date(2026, 10, 20), prevOf);
        expect(done.basis).toBe('completed');
        expect(done.previous).toEqual({ start: '2026-09-12', end: '2026-10-11' });
    });
    it('inPeriod works on cycle objects (inclusive bounds)', () => {
        const p = cyclePeriod('2026-10', c);
        expect(inPeriod('2026-10-12', p)).toBe(true);
        expect(inPeriod('2026-11-11', p)).toBe(true);
        expect(inPeriod('2026-11-12', p)).toBe(false);
        expect(cycleForDate('2026-11-12', c).id).toBe('2026-11');
    });
});
