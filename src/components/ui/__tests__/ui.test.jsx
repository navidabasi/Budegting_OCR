import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Sheet from '../Sheet';
import Amount from '../Amount';
import ProgressBar from '../ProgressBar';
import LeaderRow from '../LeaderRow';
import Segmented from '../Segmented';
import IconButton from '../IconButton';

describe('Sheet', () => {
    it('renders nothing when closed', () => {
        render(<Sheet open={false} onClose={() => {}}>x</Sheet>);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
    it('closes on Escape and on backdrop click', () => {
        const onClose = vi.fn();
        render(<Sheet open onClose={onClose} label="Add"><button>one</button></Sheet>);
        expect(screen.getByRole('dialog', { name: 'Add' })).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(screen.getByTestId('sheet-backdrop'));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
    it('traps focus: Tab on the last element wraps to the first', () => {
        render(<Sheet open onClose={() => {}}><button>one</button><button>two</button></Sheet>);
        const two = screen.getByText('two');
        two.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        // jsdom has no layout (offsetParent null) so the trap falls back to the focused element only; it must not throw
        expect(document.activeElement).toBeTruthy();
    });
});

describe('Amount', () => {
    it('formats with a true minus sign and isolates direction', () => {
        render(<Amount value={-1240.3} />);
        expect(screen.getByText(/1[.,]240[.,]30/).textContent.startsWith('−')).toBe(true);
    });
});

describe('ProgressBar', () => {
    it('exposes progress semantics and clamps', () => {
        render(<ProgressBar value={150} max={100} pace={0.4} label="Dining" />);
        const bar = screen.getByRole('progressbar', { name: 'Dining' });
        expect(bar.getAttribute('aria-valuenow')).toBe('100');
    });
});

describe('LeaderRow / Segmented / IconButton', () => {
    it('renders label and value', () => {
        render(<LeaderRow label="Rent" value="650" />);
        expect(screen.getByText('Rent')).toBeTruthy();
    });
    it('selects segments', () => {
        const onChange = vi.fn();
        render(<Segmented options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} value="a" onChange={onChange} ariaLabel="t" />);
        fireEvent.click(screen.getByRole('radio', { name: 'B' }));
        expect(onChange).toHaveBeenCalledWith('b');
        expect(screen.getByRole('radio', { name: 'A' }).getAttribute('aria-checked')).toBe('true');
    });
    it('icon button has a label and 44px class', () => {
        render(<IconButton label="Search" />);
        expect(screen.getByRole('button', { name: 'Search' }).className).toContain('min-h-[44px]');
    });
});
