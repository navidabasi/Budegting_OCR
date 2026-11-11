import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChatPanel from '../ChatPanel';

const aggregates = { month: '2026-11' };
const reply = (body, status = 200) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
const mount = (fetchImpl) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ChatPanel aggregates={aggregates} month="2026-11" language="en" fetchImpl={fetchImpl} getToken={async () => 'tok'} /></MemoryRouter></QueryClientProvider>);

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

describe('ChatPanel', () => {
    it('sends a suggested question and renders the answer with an action link that only navigates', async () => {
        const fetchImpl = reply({ answer: 'Cap dining at 150.', suggestedAction: { type: 'set_budget', payload: { category: 'Dining', amount: 150 } }, model: 'm' });
        mount(fetchImpl);
        fireEvent.click(screen.getByRole('button', { name: 'Where can I cut 100 €?' }));
        await screen.findByText('Cap dining at 150.');
        const link = screen.getByRole('link', { name: /Set Dining budget to/ });
        expect(link.getAttribute('href')).toBe('/plan?m=2026-11&budget=Dining&amount=150');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages).toEqual([{ role: 'user', content: 'Where can I cut 100 €?' }]);
    });
    it('shows the rate-limit message for 429', async () => {
        mount(reply({}, 429));
        fireEvent.change(screen.getByLabelText('Ask about your spending'), { target: { value: 'hello' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText(/Daily AI limit reached/);
    });
    it('shows an error bubble with retry on server errors, and keeps only the last 10 messages in sessionStorage', async () => {
        const seed = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
        sessionStorage.setItem('wmw-chat-thread', JSON.stringify(seed));
        const fetchImpl = reply({}, 500);
        mount(fetchImpl);
        fireEvent.change(screen.getByLabelText('Ask about your spending'), { target: { value: 'again' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await screen.findByText('Something went wrong. Try again.');
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
        await waitFor(() => expect(JSON.parse(sessionStorage.getItem('wmw-chat-thread')).length).toBeLessThanOrEqual(10));
    });
});
