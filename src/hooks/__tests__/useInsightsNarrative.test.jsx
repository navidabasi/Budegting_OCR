import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../services/accessToken', () => ({ getAccessToken: async () => 'tok' }));
import { useInsightsNarrative } from '../useInsightsNarrative';
import { hashAggregates } from '../../services/insightsAggregates';

const agg = (spent) => ({ version: 1, month: '2026-11', period: { kind: 'month', start: '2026-11-01', end: '2026-11-30' }, currency: 'EUR', summary: { spent }, categoriesByMonth: {}, savingsSeries: [], budgets: [], goals: [] });
const narrative = { headline: 'H', summary: 'S', wins: [], concerns: [], actions: [], questions: [], generatedAt: '2026-11-10T10:00:00Z', model: 'm', cached: false };
const ok = () => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => narrative });
const KEY = 'wmw.narrative:2026-11-01..2026-11-30:en';

beforeEach(() => localStorage.clear());

describe('insights narrative freshness', () => {
    it('asks once when there is no summary yet and remembers it with its source hash', async () => {
        const fetchImpl = ok();
        const { result } = renderHook(() => useInsightsNarrative({ aggregates: agg(100), language: 'en', fetchImpl }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(JSON.parse(localStorage.getItem(KEY)).hash).toBe(hashAggregates(agg(100)));
        expect(result.current.stale).toBe(false);
    });

    it('labels the summary stale when the data changed, and does not call the AI by itself', async () => {
        localStorage.setItem(KEY, JSON.stringify({ data: narrative, hash: hashAggregates(agg(100)) }));
        const fetchImpl = ok();
        const { result, rerender } = renderHook(({ a }) => useInsightsNarrative({ aggregates: a, language: 'en', fetchImpl }), { initialProps: { a: agg(100) } });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.stale).toBe(false);
        rerender({ a: agg(250) });
        await waitFor(() => expect(result.current.stale).toBe(true));
        rerender({ a: agg(260) });
        expect(fetchImpl).not.toHaveBeenCalled();
        // only an explicit update asks again
        await act(async () => {
            await result.current.refresh();
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(result.current.stale).toBe(false));
    });
});
