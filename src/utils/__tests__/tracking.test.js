import { describe, it, expect } from 'vitest'
import { normalizeTrackingData } from '../tracking'

describe('normalizeTrackingData', () => {
    it('returns null for empty or non-object input', () => {
        expect(normalizeTrackingData(null)).toBeNull()
        expect(normalizeTrackingData('open')).toBeNull()
        expect(normalizeTrackingData({})).toBeNull()
    })
    it('returns null when explicitly untracked without a status', () => {
        expect(normalizeTrackingData({ isTracked: false })).toBeNull()
    })
    it('infers isTracked from a known status', () => {
        expect(normalizeTrackingData({ status: 'done', completedAt: 'x' })).toEqual({
            isTracked: true,
            status: 'done',
            completedAt: 'x',
            sourceRecurringId: null,
        })
    })
    it('defaults unknown status to open when tracked', () => {
        expect(normalizeTrackingData({ isTracked: true, status: 'weird', sourceRecurringId: 'r1' })).toEqual({
            isTracked: true,
            status: 'open',
            completedAt: null,
            sourceRecurringId: 'r1',
        })
    })
})
