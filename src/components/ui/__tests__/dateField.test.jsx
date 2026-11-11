import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DateField, { formatDateLabel } from '../DateField';

afterEach(cleanup);

describe('formatDateLabel', () => {
    it('formats as a local date without shifting the day in any timezone', () => {
        expect(formatDateLabel('2026-11-08', 'en-GB')).toBe('8 Nov 2026');
        expect(formatDateLabel('2026-01-01', 'en-GB')).toBe('1 Jan 2026');
    });
    it('returns an empty string for missing or malformed values', () => {
        expect(formatDateLabel('', 'en')).toBe('');
        expect(formatDateLabel('11/08/2026', 'en')).toBe('');
    });
});

describe('DateField', () => {
    it('draws the date itself and keeps the native input as the tap target', () => {
        render(<DateField value="2026-11-08" onChange={() => {}} label="Target date" />);
        const input = screen.getByLabelText('Target date');
        expect(input.getAttribute('type')).toBe('date');
        expect(input.className).toContain('date-overlay');
        expect(input.className).not.toContain('pointer-events-none');
        expect(screen.getByText(/(8 Nov|Nov 8),? 2026/)).toBeTruthy();
    });
    it('shows a hint when empty instead of a blank box', () => {
        render(<DateField value="" onChange={() => {}} label="From" placeholder="Pick a date" />);
        expect(screen.getByText('Pick a date')).toBeTruthy();
    });
    it('reports the chosen date and can refuse clearing a required date', () => {
        const onChange = vi.fn();
        render(<DateField value="2026-11-08" onChange={onChange} label="Date" allowEmpty={false} />);
        const input = screen.getByLabelText('Date');
        fireEvent.change(input, { target: { value: '2026-11-10' } });
        expect(onChange).toHaveBeenCalledWith('2026-11-10');
        fireEvent.change(input, { target: { value: '' } });
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
