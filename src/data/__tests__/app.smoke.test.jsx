import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Supabase is not configured in tests (no env): the app must still render from the local mirror.
vi.mock('../../services/supabaseService', () => ({
    supabase: null,
    authHelpers: {
        getSession: async () => null,
        onAuthStateChange: () => ({ data: { subscription: null } }),
    },
    supabaseService: {},
}));

// jsdom has no canvas: stub the chart components
vi.mock('react-chartjs-2', () => {
    const Stub = () => null;
    return { Line: Stub, Bar: Stub, Doughnut: Stub, Pie: Stub };
});

import App from '../../App';
import { db, openDb } from '../db';
import { queryClient } from '../queryClient';
import { useAppStore } from '../../store/appStore';
import { createTransaction, saveSettings } from '../repo';

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    queryClient.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    window.scrollTo = () => {};
});

async function renderApp(path) {
    window.history.pushState({}, '', path);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <App />
            </QueryClientProvider>
        );
    });
    await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
    });
    return { el, root };
}

describe('App smoke (offline, local mirror)', () => {
    it('renders the receipts list from IndexedDB for a signed-in user', async () => {
        useAppStore.setState({ currentUser: { userId: 'u1', email: 'a@b.c' }, isAuthenticated: true });
        await saveSettings('u1', { defaultCurrency: 'EUR', languageCode: 'en' });
        await createTransaction({ userId: 'u1', merchant: 'Esselunga Smoke', total: 42.1, date: '2026-11-08', category: 'Groceries' });

        const { el, root } = await renderApp('/activity');
        expect(el.textContent).toContain('Esselunga Smoke');
        await act(async () => root.unmount());
    });

    it('renders the dashboard and receipt detail for a signed-in user', async () => {
        useAppStore.setState({ currentUser: { userId: 'u1', email: 'a@b.c' }, isAuthenticated: true });
        const id = await createTransaction({ userId: 'u1', merchant: 'Detail Smoke', total: 9.9, date: '2026-11-08', category: 'Groceries' });

        const detail = await renderApp(`/receipts/${id}`);
        expect(detail.el.textContent).toContain('Detail Smoke');
        await act(async () => detail.root.unmount());

        const home = await renderApp('/');
        expect(home.el.textContent.length).toBeGreaterThan(20);
        await act(async () => home.root.unmount());
    });

    it('renders the settings sidebar with stored settings and custom categories', async () => {
        useAppStore.setState({ currentUser: { userId: 'u1', email: 'a@b.c' }, isAuthenticated: true, sidebarOpen: true });
        await saveSettings('u1', { defaultCurrency: 'USD', ocrApiKey: 'my-key' });
        const { createCategory } = await import('../repo');
        await createCategory('u1', { name: 'Pets Smoke', color: '#123456' });

        const { el, root } = await renderApp('/');
        expect(el.textContent).toContain('Pets Smoke');
        expect([...el.querySelectorAll('input')].some((i) => i.value === 'my-key')).toBe(true);
        await act(async () => root.unmount());
        useAppStore.setState({ sidebarOpen: false });
    });

    it('renders the landing page when signed out', async () => {
        useAppStore.setState({ currentUser: null, isAuthenticated: false });
        const { el, root } = await renderApp('/');
        expect(el.textContent.length).toBeGreaterThan(20);
        await act(async () => root.unmount());
    });
});
