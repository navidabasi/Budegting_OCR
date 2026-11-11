import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../services/aiActions', async (orig) => ({ ...(await orig()), applyProposal: vi.fn(async () => ({ id: 'e1' })), loadLog: vi.fn(async () => []) }));
vi.mock('../../../data/queryClient', () => ({ notifyDataChanged: vi.fn(), queryClient: {} }));

import ProposalSheet from '../ProposalSheet';
import { applyProposal } from '../../../services/aiActions';

const proposal = { id: 'p1', type: 'recategorise', category: 'Fuel', records: [{ id: 'a', merchant: 'Q8', date: '2026-11-05', amount: 30, currency: 'EUR', category: 'Other' }, { id: 'b', merchant: 'Q8', date: '2026-11-07', amount: 25, currency: 'EUR', category: 'Other' }] };
const mount = (p, props = {}) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ProposalSheet proposal={p} onClose={vi.fn()} {...props} /></MemoryRouter></QueryClientProvider>);
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ProposalSheet', () => {
    it('previews the records and changes nothing until Apply is pressed', () => {
        mount(proposal);
        expect(screen.getAllByTestId('proposal-record')).toHaveLength(2);
        expect(screen.getByText(/Nothing has changed yet/)).toBeTruthy();
        expect(applyProposal).not.toHaveBeenCalled();
    });
    it('applies once even when tapped twice, then reports back', async () => {
        const onApplied = vi.fn();
        const onClose = vi.fn();
        mount(proposal, { onApplied, onClose });
        const btn = screen.getByTestId('proposal-apply');
        fireEvent.click(btn);
        fireEvent.click(btn);
        await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
        expect(applyProposal).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
    });
    it('shows a failure and keeps the sheet open when applying fails', async () => {
        applyProposal.mockRejectedValueOnce(new Error('boom'));
        const onClose = vi.fn();
        mount(proposal, { onClose });
        fireEvent.click(screen.getByTestId('proposal-apply'));
        await screen.findByRole('alert');
        expect(onClose).not.toHaveBeenCalled();
    });
    it('a prepared correction only links to the record', () => {
        mount({ id: 'p2', type: 'prepare_correction', record: { id: 'x', merchant: 'Lidl', date: '2026-11-05', amount: 40, currency: 'EUR' } });
        expect(screen.getByRole('link', { name: 'Open record' }).getAttribute('href')).toBe('/receipts/x');
        expect(screen.queryByTestId('proposal-apply')).toBeNull();
    });
});
