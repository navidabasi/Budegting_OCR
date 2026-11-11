import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
vi.mock('../../../data/api', () => ({
    isConfigured: vi.fn(() => false),
    isMissingTableError: vi.fn(() => false),
    isTransientError: vi.fn(() => false),
    insert: vi.fn(async (_t, rec) => rec),
    update: vi.fn(async () => null),
    upsert: vi.fn(),
    remove: vi.fn(),
    fetchUpdatedAt: vi.fn(),
    fetchOne: vi.fn(),
    fetchSince: vi.fn(async () => []),
    fetchIds: vi.fn(async () => []),
    fetchPage: vi.fn(async () => ({ rows: [], next: null })),
    PULL_PAGE: 50,
}));
import ChatPanel from '../ChatPanel';
import { db, openDb } from '../../../data/db';
import { queryClient } from '../../../data/queryClient';
import { useAppStore } from '../../../store/appStore';
import { getOpenConversationId } from '../../../services/chatPrefs';
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
const mount = (fetchImpl, c = ctx) => render(<QueryClientProvider client={queryClient}><MemoryRouter><ChatPanel ctx={c} month="2026-11" language="en" fetchImpl={fetchImpl} getToken={async () => 'tok'} /></MemoryRouter></QueryClientProvider>);

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    queryClient.clear();
    sessionStorage.clear();
    localStorage.clear();
    useAppStore.setState({ currentUser: { userId: 'u' } });
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

    it('renders an action link that only navigates, and saves the thread in the history', async () => {
        const fetchImpl = reply({ answer: 'Cap dining at 150.', suggestedAction: { type: 'set_budget', payload: { category: 'Dining', amount: 150 } }, citations: ['F1'], proposals: [] });
        mount(fetchImpl);
        fireEvent.change(screen.getByLabelText('Ask about your spending'), { target: { value: 'where can I cut' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText('Cap dining at 150.');
        expect(screen.getByRole('link', { name: /Set Dining budget to/ }).getAttribute('href')).toBe('/plan?m=2026-11&budget=Dining&amount=150');
        await waitFor(async () => expect(await db.chatMessages.count()).toBe(2));
        expect(sessionStorage.getItem('wmw-chat-thread')).toBeNull();
    });
});

describe('ChatPanel history', () => {
    it('starts a conversation on the first question, titled with it trimmed to 60 characters, and stores evidence in meta', async () => {
        const long = 'where did my money go on groceries and everything else this month please tell me';
        mount(reply({ answer: 'Groceries were 100.00 so far.', citations: ['F2'], proposals: [] }));
        fireEvent.change(screen.getByLabelText('Ask about your spending'), { target: { value: long } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText('Groceries were 100.00 so far.');
        const convs = await db.chatConversations.toArray();
        expect(convs).toHaveLength(1);
        expect(convs[0].title).toBe(long.slice(0, 60).trim());
        expect(getOpenConversationId('u')).toBe(convs[0].id);
        const rows = (await db.chatMessages.toArray()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
        expect(rows[1].meta.ev.citations).toEqual(['F2']);
        expect(rows[1].meta.ev.pack.period.start).toBe('2026-11-01');
        expect(JSON.stringify(rows[1].meta).length).toBeLessThan(100 * 1024);
    });

    it('a reopened answer renders exactly as before: period, basis, coverage, evidence list and link', async () => {
        const body = { answer: 'Cap groceries at 150.', suggestedAction: { type: 'open_filter', payload: { screen: 'activity', category: 'Groceries' } }, citations: ['F2'], proposals: [] };
        const first = mount(reply(body));
        fireEvent.click(screen.getByRole('button', { name: 'Where did grocery money go?' }));
        await screen.findByText('Cap groceries at 150.');
        const meta = screen.getByTestId('evidence-meta').textContent;
        const href = screen.getByRole('link', { name: /Show these transactions/ }).getAttribute('href');
        first.unmount();
        queryClient.clear();
        mount(reply({}, 500)); // new mount: no request may be needed to show it
        await screen.findByText('Cap groceries at 150.');
        expect(screen.getByTestId('evidence-meta').textContent).toBe(meta);
        expect(screen.getByTestId('evidence-coverage')).toBeTruthy();
        expect(screen.getByRole('link', { name: /Show these transactions/ }).getAttribute('href')).toBe(href);
        expect(href).toMatch(/r%3A2026-11-01\.\.2026-11-30|r:2026-11-01\.\.2026-11-30/);
        fireEvent.click(screen.getByTestId('evidence-toggle'));
        expect(within(screen.getByTestId('evidence-list')).getAllByTestId('evidence-fact').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByTestId('evidence-toggle'));
        expect(screen.queryByTestId('evidence-list')).toBeNull();
    });

    it('stores error answers, offers Retry on the last one, and sends only the current conversation to the model', async () => {
        const fetchImpl = reply({}, 500);
        mount(fetchImpl);
        fireEvent.click(screen.getByRole('button', { name: 'Top supermarket this cycle' }));
        await screen.findByText('Something went wrong. Try again.');
        await waitFor(async () => expect((await db.chatMessages.toArray()).some((m) => m.meta?.error)).toBe(true));
        fetchImpl.mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'Conad leads.', citations: ['F2'], proposals: [] }) });
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('Conad leads.');
        expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull(); // only the last message offers it
        const sent = JSON.parse(fetchImpl.mock.calls[1][1].body).messages;
        expect(sent).toEqual([{ role: 'user', content: 'Top supermarket this cycle' }]);
    });

    it('New chat starts a second conversation; the model only sees the current one', async () => {
        const fetchImpl = reply({ answer: 'ok', citations: ['F1'], proposals: [] });
        mount(fetchImpl);
        const ask = async (q, calls) => {
            fireEvent.change(screen.getByLabelText('Ask about your spending'), { target: { value: q } });
            fireEvent.click(screen.getByRole('button', { name: 'Send' }));
            await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(calls));
            await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy());
        };
        await ask('first question', 1);
        await screen.findByText('ok');
        fireEvent.click(screen.getByTestId('chat-new'));
        await ask('second question', 2);
        await waitFor(async () => expect(await db.chatConversations.count()).toBe(2));
        const last = JSON.parse(fetchImpl.mock.calls[1][1].body).messages;
        expect(last).toEqual([{ role: 'user', content: 'second question' }]);
    });

    it('moves a thread left in sessionStorage into a conversation once, then removes the key', async () => {
        sessionStorage.setItem('wmw-chat-thread', JSON.stringify([{ role: 'user', content: 'old question' }, { role: 'assistant', content: 'old answer' }]));
        mount(reply({}));
        await screen.findByText('old answer');
        expect(sessionStorage.getItem('wmw-chat-thread')).toBeNull();
        expect(await db.chatConversations.count()).toBe(1);
        expect(await db.chatMessages.count()).toBe(2);
        expect((await db.chatConversations.toArray())[0].title).toBe('old question');
    });

    it('with "Keep chat history" off nothing is written and the thread lives in the session as before', async () => {
        localStorage.setItem('wmw.chatKeepHistory', 'off');
        mount(reply({ answer: 'session answer', citations: ['F1'], proposals: [] }));
        fireEvent.click(screen.getByRole('button', { name: 'Where did grocery money go?' }));
        await screen.findByText('session answer');
        expect(await db.chatConversations.count()).toBe(0);
        expect(await db.chatMessages.count()).toBe(0);
        expect(JSON.parse(sessionStorage.getItem('wmw-chat-thread')).length).toBe(2);
    });

    it('shows an "Earlier messages" button when older messages exist and loads them on tap', async () => {
        await db.chatConversations.put({ id: 'c1', userId: 'u', title: 'Old', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T01:00:00.000Z', deletedAt: null });
        const rows = Array.from({ length: 40 }, (_, i) => ({ id: `m${String(i).padStart(2, '0')}`, userId: 'u', conversationId: 'c1', role: i % 2 ? 'assistant' : 'user', content: `message ${i}`, meta: null, createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), updatedAt: '2026-11-01T01:00:00.000Z', deletedAt: null }));
        await db.chatMessages.bulkPut(rows);
        localStorage.setItem('wmw.chatOpen:u', 'c1');
        mount(reply({}));
        await screen.findByText('message 39');
        expect(screen.queryByText('message 5')).toBeNull(); // the newest 30 only (10..39)
        fireEvent.click(await screen.findByTestId('chat-earlier'));
        await screen.findByText('message 5');
        expect(screen.queryByTestId('chat-earlier')).toBeNull();
    });
});
