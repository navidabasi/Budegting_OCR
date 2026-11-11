import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../hooks/useMoney', () => ({ useMoney: () => ({ currency: 'EUR', money: (v, c = 'EUR') => `${c} ${Number(v).toFixed(2)}` }) }));
vi.mock('../../../services/exchangeRateService', () => ({ getRateInfo: vi.fn(async () => null), todayKey: () => '2026-11-11' }));
import ConversionCard from '../ConversionCard';
import { getRateInfo } from '../../../services/exchangeRateService';

const pending = { id: 'a', total: 50, currency: 'USD', amountBase: null, extraction: null };
afterEach(cleanup);

describe('ConversionCard', () => {
    it('shows a pending conversion honestly and asks for the amount', () => {
        render(<ConversionCard receipt={pending} onSave={vi.fn()} />);
        expect(screen.getByTestId('fx-status').textContent).toBe('Waiting for a rate');
        expect(screen.getByText(/not counted in totals|not counted in totals/i)).toBeTruthy();
        expect(screen.getByTestId('fx-edit').textContent).toMatch(/Set the EUR amount/);
    });

    it('typing the charged amount saves a confirmed conversion and derives the rate', async () => {
        const onSave = vi.fn().mockResolvedValue();
        render(<ConversionCard receipt={pending} onSave={onSave} />);
        fireEvent.click(screen.getByTestId('fx-edit'));
        fireEvent.change(screen.getByTestId('fx-amount'), { target: { value: '44,37' } });
        expect(screen.getByTestId('fx-rate').value).toBe('0.8874');
        fireEvent.click(screen.getByTestId('fx-save'));
        await waitFor(() => expect(onSave).toHaveBeenCalled());
        const patch = onSave.mock.calls[0][0];
        expect(patch).toMatchObject({ amountBase: 44.37, baseCurrency: 'EUR', exchangeRate: 0.8874 });
        expect(patch.extraction.fx).toMatchObject({ status: 'confirmed', source: 'charged' });
    });

    it('typing a rate saves an estimate marked as entered by hand', async () => {
        const onSave = vi.fn().mockResolvedValue();
        render(<ConversionCard receipt={pending} onSave={onSave} />);
        fireEvent.click(screen.getByTestId('fx-edit'));
        fireEvent.change(screen.getByTestId('fx-rate'), { target: { value: '0.9' } });
        expect(screen.getByTestId('fx-amount').value).toBe('45');
        fireEvent.click(screen.getByTestId('fx-save'));
        await waitFor(() => expect(onSave).toHaveBeenCalled());
        expect(onSave.mock.calls[0][0].extraction.fx).toMatchObject({ status: 'estimated', source: 'manual' });
    });

    it('offline "use the latest rate" says no rate is available instead of guessing', async () => {
        render(<ConversionCard receipt={pending} onSave={vi.fn()} />);
        fireEvent.click(screen.getByTestId('fx-edit'));
        fireEvent.click(screen.getByRole('button', { name: 'Use the latest rate' }));
        await screen.findByRole('alert');
        expect(getRateInfo).toHaveBeenCalled();
        expect(screen.getByTestId('fx-save').disabled).toBe(true);
    });

    it('renders nothing for a base-currency record', () => {
        const { container } = render(<ConversionCard receipt={{ ...pending, currency: 'EUR', amountBase: 50 }} onSave={vi.fn()} />);
        expect(container.querySelector('[data-testid="conversion-card"]')).toBeNull();
    });

    it('a confirmed conversion shows its source and rate, an estimate shows the date of the rate table', () => {
        const { rerender } = render(<ConversionCard receipt={{ ...pending, amountBase: 44.37, exchangeRate: 0.8874, extraction: { fx: { status: 'confirmed', source: 'bank', date: '2026-11-04' } } }} onSave={vi.fn()} />);
        expect(screen.getByTestId('fx-status').textContent).toBe('Confirmed');
        expect(screen.getByText(/matched bank row/)).toBeTruthy();
        rerender(<ConversionCard receipt={{ ...pending, amountBase: 45, exchangeRate: 0.9, extraction: { fx: { status: 'estimated', source: 'api', date: '2026-11-03' } } }} onSave={vi.fn()} />);
        expect(screen.getByTestId('fx-status').textContent).toBe('Estimated');
        expect(screen.getByText(/not necessarily the purchase day/)).toBeTruthy();
    });
});
