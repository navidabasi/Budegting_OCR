import { describe, it, expect, afterEach } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
import { notifyDataChanged, queryClient } from '../queryClient';

afterEach(() => queryClient.clear());

describe('notifyDataChanged', () => {
    it('a query on its first fetch still picks up a change written while it was loading', async () => {
        // the mirror: a read takes 30 ms and returns what was there when it started
        let rows = ['question'];
        const read = async () => {
            const snapshot = [...rows];
            await new Promise((r) => setTimeout(r, 30));
            return snapshot;
        };
        const observer = new QueryObserver(queryClient, { queryKey: ['data', 'chatMessages', 'c1'], queryFn: read });
        const seen = [];
        const stop = observer.subscribe((r) => r.data && seen.push(r.data));
        await new Promise((r) => setTimeout(r, 5)); // the first fetch is in flight
        rows = ['question', 'answer']; // the answer is written...
        await notifyDataChanged(); // ...and the data layer says so
        await new Promise((r) => setTimeout(r, 80)); // the repair read is not awaited by the writer
        expect(queryClient.getQueryData(['data', 'chatMessages', 'c1'])).toEqual(['question', 'answer']);
        expect(seen.at(-1)).toEqual(['question', 'answer']);
        stop();
    });
    it('a loaded query is simply refetched', async () => {
        let n = 0;
        const observer = new QueryObserver(queryClient, { queryKey: ['data', 'x'], queryFn: async () => ++n });
        const stop = observer.subscribe(() => {});
        await new Promise((r) => setTimeout(r, 5));
        await notifyDataChanged();
        expect(queryClient.getQueryData(['data', 'x'])).toBe(2);
        stop();
    });
});
