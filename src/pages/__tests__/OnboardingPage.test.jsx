import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent } from '@testing-library/react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));

import OnboardingPage, { onboardedKey } from '../OnboardingPage';
import { db, openDb } from '../../data/db';
import { queryClient } from '../../data/queryClient';
import { useAppStore } from '../../store/appStore';

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    queryClient.clear();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    useAppStore.setState({ currentUser: { userId: 'u9', email: 'a@b.c' }, isAuthenticated: true, languageCode: 'en' });
});

const click = async (name) => act(async () => fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name)));

describe('OnboardingPage', () => {
    it('creates Revolut / PostePay / Cash preselected, a whole-month budget and marks the user onboarded', async () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const root = createRoot(el);
        await act(async () => root.render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/welcome']}><Routes><Route path="/welcome" element={<OnboardingPage />} /><Route path="/" element={<div>HOME</div>} /></Routes></MemoryRouter></QueryClientProvider>));
        await click('Next');
        await click('PostePay'); // turn one off
        await click('Next');
        await act(async () => fireEvent.change(document.querySelector('input[inputmode="decimal"]'), { target: { value: '1200' } }));
        await click('Start tracking');
        await act(async () => new Promise((r) => setTimeout(r, 120)));
        const accounts = await db.accounts.toArray();
        expect(accounts.map((a) => [a.name, a.kind]).sort()).toEqual([['Cash', 'cash'], ['Revolut', 'spending']]);
        const budgets = await db.budgets.toArray();
        expect(budgets).toHaveLength(1);
        expect(budgets[0]).toMatchObject({ category: '*', amount: 1200 });
        expect(localStorage.getItem(onboardedKey('u9'))).toBe('1');
        expect(document.body.textContent).toContain('HOME');
        await act(async () => root.unmount());
    });
});
