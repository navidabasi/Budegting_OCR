import { describe, it, expect } from 'vitest'
import { monthKey, dateKey, daysInMonth, monthStart, monthEnd, addMonths, previousMonths, monthsBetween, daysBetween, addDays, monthProgress, safeToSpendPerDay } from '../monthMath'

describe('month keys', () => {
    it('derives keys from strings and Dates without timezone drift', () => {
        expect(monthKey('2026-11-30')).toBe('2026-11')
        expect(monthKey('2026-11-30T23:59:59Z')).toBe('2026-11')
        expect(monthKey(new Date(2026, 0, 31))).toBe('2026-01')
        expect(monthKey('nope')).toBe('')
        expect(monthKey(null)).toBe('')
        expect(dateKey(new Date(2026, 10, 5))).toBe('2026-11-05')
    })
    it('days, start and end of month (leap years included)', () => {
        expect(daysInMonth('2026-02')).toBe(28)
        expect(daysInMonth('2028-02')).toBe(29)
        expect(daysInMonth('2026-11')).toBe(30)
        expect(monthStart('2026-11-18')).toBe('2026-11-01')
        expect(monthEnd('2026-02')).toBe('2026-02-28')
    })
    it('adds months across year boundaries', () => {
        expect(addMonths('2026-11', 1)).toBe('2026-12')
        expect(addMonths('2026-12', 1)).toBe('2027-01')
        expect(addMonths('2026-01', -1)).toBe('2025-12')
        expect(addMonths('2026-01', -13)).toBe('2024-12')
        expect(previousMonths('2026-02', 3)).toEqual(['2025-11', '2025-12', '2026-01'])
        expect(monthsBetween('2025-11', '2026-02')).toBe(3)
    })
    it('day arithmetic', () => {
        expect(daysBetween('2026-11-01', '2026-11-04')).toBe(3)
        expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
        expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
        expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    })
})

describe('monthProgress', () => {
    it('current month', () => {
        const p = monthProgress('2026-11', '2026-11-10')
        expect(p).toMatchObject({ day: 10, days: 30, daysLeft: 21, state: 'current' })
        expect(p.pct).toBeCloseTo(33.33, 1)
    })
    it('past and future months', () => {
        expect(monthProgress('2026-10', '2026-11-10')).toMatchObject({ day: 31, daysLeft: 0, state: 'past' })
        expect(monthProgress('2026-12', '2026-11-10')).toMatchObject({ day: 0, daysLeft: 31, state: 'future' })
    })
})

describe('safeToSpendPerDay', () => {
    it('spreads what is left (after upcoming bills) over the remaining days including today', () => {
        // budget 1000, spent 400, upcoming 90, today 10 Nov -> 21 days left -> 510 / 21
        expect(safeToSpendPerDay({ budget: 1000, spent: 400, upcoming: 90, month: '2026-11', today: '2026-11-10' })).toBeCloseTo(510 / 21, 6)
    })
    it('never negative, null without budget or after the month', () => {
        expect(safeToSpendPerDay({ budget: 100, spent: 150, month: '2026-11', today: '2026-11-10' })).toBe(0)
        expect(safeToSpendPerDay({ budget: 0, spent: 0, month: '2026-11', today: '2026-11-10' })).toBeNull()
        expect(safeToSpendPerDay({ budget: 100, spent: 0, month: '2026-10', today: '2026-11-10' })).toBeNull()
    })
    it('last day of the month has one day left', () => {
        expect(safeToSpendPerDay({ budget: 100, spent: 70, month: '2026-11', today: '2026-11-30' })).toBe(30)
    })
})
