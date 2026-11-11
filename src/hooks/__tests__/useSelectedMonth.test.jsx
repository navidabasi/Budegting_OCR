import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useSelectedMonth } from '../useSelectedMonth';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NOW = new Date(2026, 10, 10); // 10 Nov 2026

let api;
let loc;
function Probe() {
    api = useSelectedMonth(NOW);
    loc = useLocation();
    return null;
}
async function mount(url) {
    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => root.render(<MemoryRouter initialEntries={[url]}><Probe /></MemoryRouter>));
    return root;
}

describe('useSelectedMonth', () => {
    it('defaults to the current month and keeps the URL clean', async () => {
        await mount('/');
        expect(api.month).toBe('2026-11');
        expect(api.isCurrent).toBe(true);
        expect(loc.search).toBe('');
    });
    it('reads ?m=YYYY-MM and ignores garbage', async () => {
        await mount('/?m=2026-09');
        expect(api.month).toBe('2026-09');
        expect(api.isCurrent).toBe(false);
        await mount('/?m=2026-13');
        expect(api.month).toBe('2026-11');
        await mount('/?m=nope');
        expect(api.month).toBe('2026-11');
    });
    it('prev/next/setMonth update the URL, other params survive, current month removes ?m', async () => {
        await mount('/plan?tab=savings');
        await act(async () => api.prev());
        expect(api.month).toBe('2026-10');
        expect(loc.search).toBe('?tab=savings&m=2026-10');
        await act(async () => api.prev());
        await act(async () => api.prev());
        expect(api.month).toBe('2026-08');
        await act(async () => api.shift(3));
        expect(api.month).toBe('2026-11');
        expect(loc.search).toBe('?tab=savings');
        await act(async () => api.setMonth('2027-01'));
        expect(api.month).toBe('2027-01');
    });
});
