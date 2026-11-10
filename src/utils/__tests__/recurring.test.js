import { describe, it, expect } from 'vitest'
import { calculateNextRecurringDate } from '../recurring'

describe('calculateNextRecurringDate', () => {
    it('adds the right interval per frequency', () => {
        expect(calculateNextRecurringDate('2026-01-10', 'weekly')).toBe('2026-01-17')
        expect(calculateNextRecurringDate('2026-01-10', 'biweekly')).toBe('2026-01-24')
        expect(calculateNextRecurringDate('2026-01-10', 'monthly')).toBe('2026-02-10')
        expect(calculateNextRecurringDate('2026-01-10', 'quarterly')).toBe('2026-04-10')
        expect(calculateNextRecurringDate('2026-01-10', 'yearly')).toBe('2027-01-10')
    })
    it('defaults to monthly for unknown frequencies', () => {
        expect(calculateNextRecurringDate('2026-01-10', 'bogus')).toBe('2026-02-10')
        expect(calculateNextRecurringDate('2026-01-10')).toBe('2026-02-10')
    })
    it('clamps month ends', () => {
        expect(calculateNextRecurringDate('2026-01-31', 'monthly')).toBe('2026-02-28')
    })
    it('accepts Date objects', () => {
        expect(calculateNextRecurringDate(new Date(2026, 11, 31), 'yearly')).toBe('2027-12-31')
    })
})
