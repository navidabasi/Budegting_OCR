import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { fireEvent } from '@testing-library/react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../../services/accessToken', () => ({ getAccessToken: async () => 'tok' }));
vi.mock('../../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));

import CategoriseSheet from '../CategoriseSheet';
import { db, openDb } from '../../../data/db';
import { useAppStore } from '../../../store/appStore';

const tx = [
    { id: '1', userId: 'u1', merchant: 'Lidl', category: 'Other', date: '2026-11-01' },
    { id: '2', userId: 'u1', merchant: 'Xyz Corp', category: 'Other', date: '2026-11-02' },
];
const names = ['Groceries', 'Dining', 'Other'];
const reply = (status, body) => vi.fn(async () => ({ status, ok: status < 400, json: async () => body }));

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    useAppStore.setState({ languageCode: 'en', toast: null });
});

async function mount(props) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<CategoriseSheet open onClose={() => {}} transactions={tx} categoryNames={names} userId="u1" {...props} />));
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    return root;
}

describe('CategoriseSheet', () => {
    it('lists merchant -> category and preselects confident rows only', async () => {
        const fetchImpl = reply(200, { results: [{ key: 'lidl', category: 'Groceries', confidence: 0.93 }, { key: 'xyz corp', category: 'Dining', confidence: 0.5 }] });
        const root = await mount({ fetchImpl });
        const rows = [...document.querySelectorAll('[data-testid="categorise-list"] li')];
        expect(rows).toHaveLength(2);
        const checks = rows.map((r) => r.querySelector('[role="checkbox"]').getAttribute('aria-checked'));
        expect(checks).toEqual(['true', 'false']);
        expect(rows[0].textContent).toContain('Groceries');
        expect(document.body.textContent).toContain('Apply to 1 transactions');
        await act(async () => root.unmount());
    });

    it('shows the "AI isn\'t set up yet" message on 503 llm_not_configured', async () => {
        const root = await mount({ fetchImpl: reply(503, { code: 'llm_not_configured' }) });
        expect(document.querySelector('[data-testid="categorise-error"]').textContent).toBe('AI isn’t set up yet. Add the model keys in Vercel to enable this.');
        await act(async () => root.unmount());
    });

    it('applies the checked rows and stores llm rules', async () => {
        const { createTransaction } = await import('../../../data/repo');
        for (const t of tx) await createTransaction(t);
        const fetchImpl = reply(200, { results: [{ key: 'lidl', category: 'Groceries', confidence: 0.93 }, { key: 'xyz corp', category: 'Dining', confidence: 0.5 }] });
        const onClose = vi.fn();
        const root = await mount({ fetchImpl, onClose });
        const apply = [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Apply to'));
        await act(async () => fireEvent.click(apply));
        await act(async () => new Promise((r) => setTimeout(r, 50)));
        const { getTransaction } = await import('../../../data/repo');
        expect((await getTransaction('1')).category).toBe('Groceries');
        expect((await getTransaction('2')).category).toBe('Other');
        expect(onClose).toHaveBeenCalled();
        expect((await db.rules.toArray())[0]).toMatchObject({ merchantKey: 'lidl', source: 'llm' });
        await act(async () => root.unmount());
    });
});
