import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MonthSwitcher from '../MonthSwitcher';

afterEach(cleanup);

describe('MonthSwitcher picker', () => {
    it('opens a month grid from the label and selects a month directly', () => {
        const onSelect = vi.fn();
        render(<MonthSwitcher month="2026-11" max="2026-11" onPrev={() => {}} onNext={() => {}} onSelect={onSelect} canNext={false} />);
        fireEvent.click(screen.getByRole('button', { name: /choose month/i }));
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(12);
        // November is selected, December (after max) is disabled
        expect(options[10].getAttribute('aria-selected')).toBe('true');
        expect(options[11].disabled).toBe(true);
        fireEvent.click(options[2]);
        expect(onSelect).toHaveBeenCalledWith('2026-03');
    });

    it('moves between years and never past the current year', () => {
        const onSelect = vi.fn();
        render(<MonthSwitcher month="2026-11" max="2026-11" onPrev={() => {}} onNext={() => {}} onSelect={onSelect} />);
        fireEvent.click(screen.getByRole('button', { name: /choose month/i }));
        expect(screen.getByRole('button', { name: /next year/i }).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: /previous year/i }));
        fireEvent.click(screen.getAllByRole('option')[11]);
        expect(onSelect).toHaveBeenCalledWith('2025-12');
    });
});
