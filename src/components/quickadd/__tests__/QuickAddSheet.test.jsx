import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent } from '@testing-library/react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));

import QuickAddSheet from '../QuickAddSheet';
import Toast from '../../common/Toast';
import { db, openDb } from '../../../data/db';
import { queryClient } from '../../../data/queryClient';
import { useAppStore } from '../../../store/appStore';
import { createGroup, createRow, createTransaction, listTransactions, saveSettings } from '../../../data/repo';

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    queryClient.clear();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    useAppStore.setState({ currentUser: { userId: 'u1', email: 'a@b.c' }, isAuthenticated: true, languageCode: 'it', toast: null });
});

async function mount(ui) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
    await act(async () => new Promise((r) => setTimeout(r, 60)));
    return root;
}
const press = async (...labels) => {
    for (const l of labels) {
        await act(async () => {
            const btn = [...document.querySelectorAll('[data-testid="keypad"] button')].find((b) => b.textContent === l || b.getAttribute('aria-label') === l);
            fireEvent.click(btn);
        });
    }
};

describe('QuickAddSheet', () => {
    it('amount-first save: keypad with comma decimal, recent merchant chip, undo toast removes the transaction', async () => {
        await saveSettings('u1', { defaultCurrency: 'EUR', languageCode: 'it' });
        const today = new Date().toISOString().slice(0, 10);
        await createTransaction({ userId: 'u1', merchant: 'Bar Roma', total: 3, date: today, category: 'Restaurant' }); // pre-v14 name, read back as Dining
        await createRow('accounts', 'u1', { name: 'Revolut', kind: 'spending', currency: 'EUR', sortOrder: 0 });
        await createRow('accounts', 'u1', { name: 'Cash', kind: 'cash', currency: 'EUR', sortOrder: 1 });
        const onClose = vi.fn();
        const root = await mount(<><QuickAddSheet open onClose={onClose} preset={null} /><Toast /></>);

        await press('1', '2', ',', '4', '0');
        expect(document.querySelector('[data-testid="amount-display"]').textContent).toContain('12,40');

        const chip = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Bar Roma');
        await act(async () => fireEvent.click(chip));
        const cash = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cash');
        await act(async () => fireEvent.click(cash));
        await press('Salva');
        await act(async () => new Promise((r) => setTimeout(r, 80)));

        const rows = await listTransactions('u1');
        const created = rows.find((r) => r.total === 12.4);
        expect(created).toBeTruthy();
        expect(created.merchant).toBe('Bar Roma');
        expect(created.category).toBe('Dining');
        expect(created.transactionType).toBe('expense');
        expect(localStorage.getItem('wmw.lastAccountId')).toBe(created.accountId);
        expect(onClose).toHaveBeenCalled();
        expect(document.body.textContent).toMatch(/Aggiunto 12,40.*Bar Roma/);

        const undo = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Annulla');
        await act(async () => fireEvent.click(undo));
        await act(async () => new Promise((r) => setTimeout(r, 80)));
        expect((await listTransactions('u1')).find((r) => r.total === 12.4)).toBeUndefined();
        await act(async () => root.unmount());
    });

    it('suggests the group of the last transaction at the same merchant (owner groups) and saves it when tapped', async () => {
        await saveSettings('u1', { defaultCurrency: 'EUR', languageCode: 'en' });
        useAppStore.setState({ languageCode: 'en' });
        const debts = await createGroup('u1', { name: 'Debts', color: '#ef4444' });
        await createGroup('u1', { name: 'Lends', color: '#3b82f6' });
        await createTransaction({ userId: 'u1', merchant: 'Klarna', total: 49.9, date: new Date().toISOString().slice(0, 10), category: 'Other', groupId: debts.id, groupName: 'Debts' });
        const root = await mount(<QuickAddSheet open onClose={() => {}} preset={null} />);
        await press('4', '9', ',', '9', '0');
        await act(async () => fireEvent.change(document.querySelector('#qa-merchant'), { target: { value: 'KLARNA' } }));
        const suggestion = document.querySelector('[data-testid="qa-group-suggestion"]');
        expect(suggestion.textContent).toContain('Debts · like last time');
        await act(async () => fireEvent.click(suggestion));
        expect(document.querySelector('[data-testid="qa-group-suggestion"]')).toBeNull();
        await press('Save');
        await act(async () => new Promise((r) => setTimeout(r, 80)));
        const saved = (await listTransactions('u1')).find((r) => r.merchant === 'KLARNA');
        expect(saved).toMatchObject({ groupId: debts.id, groupName: 'Debts' });
        await act(async () => root.unmount());
    });

    it('transfer needs two different accounts and saves type transfer', async () => {
        await saveSettings('u1', { defaultCurrency: 'EUR', languageCode: 'en' });
        useAppStore.setState({ languageCode: 'en' });
        const a = await createRow('accounts', 'u1', { name: 'Revolut', kind: 'spending', currency: 'EUR', sortOrder: 0 });
        const b = await createRow('accounts', 'u1', { name: 'Savings', kind: 'savings', currency: 'EUR', sortOrder: 1 });
        const root = await mount(<QuickAddSheet open onClose={() => {}} preset={null} />);
        await act(async () => fireEvent.click(document.querySelector('[role="radio"][aria-checked="false"]:nth-of-type(3)') || [...document.querySelectorAll('[role="radio"]')][2]));
        await press('4', '0', '0');
        const save = [...document.querySelectorAll('[data-testid="keypad"] button')].find((x) => x.textContent === 'Save');
        expect(save.disabled).toBe(true);
        await act(async () => fireEvent.click([...document.querySelectorAll('button')].filter((x) => x.textContent === 'Savings').pop()));
        expect(save.disabled).toBe(false);
        await act(async () => fireEvent.click(save));
        await act(async () => new Promise((r) => setTimeout(r, 80)));
        const tx = (await listTransactions('u1'))[0];
        expect(tx.transactionType).toBe('transfer');
        expect(tx.toAccountId).toBe(b.id);
        expect(tx.accountId).toBe(a.id);
        expect(tx.total).toBe(400);
        await act(async () => root.unmount());
    });

    it('keeps a draft after dismissal and offers "Resume draft"; saving clears it', async () => {
        await saveSettings('u1', { defaultCurrency: 'EUR', languageCode: 'en' });
        useAppStore.setState({ languageCode: 'en' });
        await createRow('accounts', 'u1', { name: 'Cash', kind: 'cash', currency: 'EUR', sortOrder: 0 });
        const root = await mount(<QuickAddSheet open onClose={() => {}} preset={null} />);
        await press('7', '5');
        await act(async () => {
            fireEvent.change(document.querySelector('#qa-merchant'), { target: { value: 'Lidl' } });
        });
        await act(async () => new Promise((r) => setTimeout(r, 600))); // debounce
        expect(await db.drafts.count()).toBe(1);
        await act(async () => root.unmount());

        // app "restart": a fresh sheet starts empty but offers the draft
        const root2 = await mount(<><QuickAddSheet open onClose={() => {}} preset={null} /><Toast /></>);
        expect(document.querySelector('[data-testid="amount-display"]').textContent).toContain('0');
        const banner = document.querySelector('[data-testid="draft-banner"]');
        expect(banner.textContent).toContain('Lidl');
        await act(async () => fireEvent.click([...banner.querySelectorAll('button')].find((b) => b.textContent === 'Resume draft')));
        expect(document.querySelector('[data-testid="amount-display"]').textContent).toContain('75');
        expect(document.querySelector('#qa-merchant').value).toBe('Lidl');

        await press('Save');
        await act(async () => new Promise((r) => setTimeout(r, 120)));
        expect(await db.drafts.count()).toBe(0);
        expect((await listTransactions('u1'))[0]).toMatchObject({ total: 75, merchant: 'Lidl' });
        await act(async () => root2.unmount());
    });

    it('two taps on Save in the same frame create one transaction and one queued insert', async () => {
        await saveSettings('u1', { defaultCurrency: 'EUR', languageCode: 'en' });
        useAppStore.setState({ languageCode: 'en' });
        const root = await mount(<QuickAddSheet open onClose={() => {}} preset={null} />);
        await press('9');
        const save = [...document.querySelectorAll('[data-testid="keypad"] button')].find((x) => x.textContent === 'Save');
        await act(async () => {
            fireEvent.click(save);
            fireEvent.click(save);
        });
        await act(async () => new Promise((r) => setTimeout(r, 150)));
        expect(await listTransactions('u1')).toHaveLength(1);
        expect((await db.outbox.toArray()).filter((e) => e.table === 'transactions' && e.op === 'insert')).toHaveLength(1);
        await act(async () => root.unmount());
    });
});
