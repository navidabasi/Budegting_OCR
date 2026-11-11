import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChatPanel from '../ChatPanel';
import { monthPeriod } from '../../../utils/payCycle';

const line = (id, name, amount, category, subcategory, extra = {}) => ({ v: 2, id, name, price: amount, amount, quantity: 1, category, subcategory, reviewStatus: 'confirmed', userEdited: [], ...extra });
const tx = (id, merchant, total, category, date, extra = {}) => ({ id, userId: 'u', merchant, total, currency: 'EUR', category, date, lineItems: [], transactionType: 'expense', createdAt: `${date}T10:00:00Z`, ...extra });
const transactions = [
    tx('t1', 'Lidl', 40, 'Groceries', '2026-11-03', { lineItems: [line('a1', 'Latte', 10, 'Groceries', 'dairy'), line('a2', 'Mele', 12, 'Groceries', 'produce')] }),
    tx('t2', 'Conad', 60, 'Groceries', '2026-11-10'),
    tx('t3', 'Lidl', 30, 'Groceries', '2026-10-04', { lineItems: [line('c1', 'Latte', 6, 'Groceries', 'dairy')] }),
];
const ctx = { transactions, trips: [], accounts: [], budgets: [], goals: [], people: [], period: monthPeriod('2026-11'), config: undefined, today: '2026-11-20', currency: 'EUR', categoryNames: ['Groceries', 'Fuel', 'Other'], suggest: () => null };
const reply = (body, status = 200) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
const mount = (fetchImpl, c = ctx) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ChatPanel ctx={c} month="2026-11" language="en" fetchImpl={fetchImpl} getToken={async () => 'tok'} /></MemoryRouter></QueryClientProvider>);

beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
});
afterEach(cleanup);

describe('ChatPanel with evidence', () => {
    it('answers "what drove grocery spending" from an evidence pack and shows period, basis, coverage and receipts', async () => {
        const fetchImpl = reply({ answer: 'Groceries were 100.00 so far.', citations: ['F2'], uncertain: [], proposals: [], model: 'm' });
        mount(fetchImpl);
        fireEvent.click(screen.getByRole('button', { name: 'Where did grocery money go?' }));
        await screen.findByText('Groceries were 100.00 so far.');
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(body.evidence.intent).toBe('grocery_breakdown');
        expect(body.evidence.period.start).toBe('2026-11-01');
        expect(body.aggregates).toBeUndefined();
        const meta = screen.getByTestId('evidence-meta').textContent;
        expect(meta).toMatch(/EUR/);
        expect(meta).toMatch(/Your share/);
        expect(meta).toMatch(/Nov 1 – Nov 30/);
        expect(screen.getByTestId('evidence-coverage').textContent).toMatch(/Item detail explains/);
        // evidence collapses and expands, and each cited fact leads to its receipts
        expect(screen.queryByTestId('evidence-list')).toBeNull();
        fireEvent.click(screen.getByTestId('evidence-toggle'));
        const list = screen.getByTestId('evidence-list');
        expect(within(list).getAllByTestId('evidence-fact').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByTestId('evidence-toggle'));
        expect(screen.queryByTestId('evidence-list')).toBeNull();
    });

    it('switches to the full-amount basis and sends it', async () => {
        const fetchImpl = reply({ answer: 'ok', citations: ['F1'], proposals: [] });
        mount(fetchImpl);
        fireEvent.click(screen.getByRole('radio', { name: 'Full amount paid' }));
        fireEvent.click(screen.getByRole('button', { name: 'Top supermarket this cycle' }));
        await screen.findByText('ok');
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).evidence.basis).toBe('full');
    });

    it('warns when the answer cites nothing or quotes figures that are not in the evidence', async () => {
        mount(reply({ answer: 'You spent 987.65 on cheese.', citations: [], proposals: [] }));
        fireEvent.click(screen.getByRole('button', { name: 'Where did grocery money go?' }));
        await screen.findByText(/987.65 on cheese/);
        expect(screen.getByTestId('evidence-ungrounded')).toBeTruthy();
        expect(screen.getByTestId('evidence-unsupported').textContent).toMatch(/987.65/);
    });

    it('is honest when there is not enough data: no request is made', async () => {
        const fetchImpl = reply({ answer: 'x' });
        mount(fetchImpl, { ...ctx, transactions: [] });
        fireEvent.click(screen.getByRole('button', { name: 'Where did grocery money go?' }));
        await screen.findByText(/no grocery receipts/);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('keeps the local facts visible when the explanation fails, and retries', async () => {
        const fetchImpl = reply({}, 500);
        mount(fetchImpl);
        fireEvent.click(screen.getByRole('button', { name: 'Top supermarket this cycle' }));
        await screen.findByText('Something went wrong. Try again.');
        expect(screen.getByTestId('evidence')).toBeTruthy();
        fetchImpl.mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'Conad leads.', citations: ['F2'], proposals: [] }) });
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('Conad leads.');
    });

    it('routes free text through the deterministic router', async () => {
        const fetchImpl = reply({ answer: 'ok', citations: ['F1'], proposals: [] });
        mount(fetchImpl);
        fireEvent.change(screen.getByLabelText('Ask about your spending'), { target: { value: 'what drove grocery spending' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText('ok');
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).evidence.intent).toBe('grocery_breakdown');
    });

    it('shows the rate-limit message for 429', async () => {
        mount(reply({}, 429));
        fireEvent.change(screen.getByLabelText('Ask about your spending'), { target: { value: 'hello' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText(/Daily AI limit reached/);
    });

    it('renders an action link that only navigates, and keeps the last 10 messages in sessionStorage', async () => {
        const fetchImpl = reply({ answer: 'Cap dining at 150.', suggestedAction: { type: 'set_budget', payload: { category: 'Dining', amount: 150 } }, citations: ['F1'], proposals: [] });
        mount(fetchImpl);
        fireEvent.change(screen.getByLabelText('Ask about your spending'), { target: { value: 'where can I cut' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText('Cap dining at 150.');
        expect(screen.getByRole('link', { name: /Set Dining budget to/ }).getAttribute('href')).toBe('/plan?m=2026-11&budget=Dining&amount=150');
        await waitFor(() => expect(JSON.parse(sessionStorage.getItem('wmw-chat-thread')).length).toBeLessThanOrEqual(10));
    });
});
