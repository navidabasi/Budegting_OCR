import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import YourPatterns from '../YourPatterns';
import GeneralTips from '../GeneralTips';
import { computePatterns } from '../../../services/patternInsights';
import { ownerLike, TODAY } from '../../../services/__fixtures__/ownerLike';
import { currentCyclePeriod, normalizeConfig } from '../../../utils/payCycle';
import { useAppStore } from '../../../store/appStore';

vi.mock('../../../data/hooks', async (orig) => ({ ...(await orig()), useSettings: () => ({ defaultCurrency: 'EUR' }) }));

const d = ownerLike();
const period = currentCyclePeriod(normalizeConfig(d.config), new Date(`${TODAY}T12:00:00Z`));
const show = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
afterEach(cleanup);

const streak = { id: 'pattern_category_streak:Entertainment:up@x', key: 'pattern_category_streak:Entertainment:up', kind: 'category_streak', severity: 'watch', params: { category: 'Entertainment', direction: 'up', periods: 4, first: 20, last: 80, change: 60, amounts: [20, 40, 60, 80] }, scope: { start: '2026-06-27', end: '2026-10-26' }, evidence: [], filter: { category: 'Entertainment' } };

describe('B-T3 Your patterns', () => {
    it('cards match the detector rows and link to the filtered Activity behind them', () => {
        const { top } = computePatterns({ ...d, period });
        show(<YourPatterns patterns={top} onDismiss={vi.fn()} onRestore={vi.fn()} />);
        const cards = screen.getAllByTestId('pattern');
        expect(cards.map((c) => c.dataset.kind)).toEqual(top.map((p) => p.kind));
        expect(within(cards[0]).getByTestId('pattern-title').textContent).toBe('Tabaccheria Centrale about every 5.9 days');
        expect(within(cards[0]).getByTestId('pattern-body').textContent).toMatch(/^34 visits in 200 days/);
        expect(within(cards[0]).getByTestId('pattern-open').getAttribute('href')).toBe('/activity?m=r%3A2026-04-27..2026-11-12&merchant=Tabaccheria+Centrale');
    });

    it('a streak shows its figures in words and its shape as bars, with the category filter', () => {
        show(<YourPatterns patterns={[streak]} onDismiss={vi.fn()} onRestore={vi.fn()} />);
        expect(screen.getByTestId('pattern-title').textContent).toBe('Entertainment rose 4 periods in a row');
        expect(screen.getByTestId('pattern-body').textContent).toMatch(/^From 20[.,]00\s€ to 80[.,]00\s€ per period\.$/);
        expect(screen.getByTestId('pattern-open').getAttribute('href')).toBe('/activity?m=r%3A2026-06-27..2026-10-26&cat=Entertainment');
    });

    it('Hide calls the shared dismissal with Undo; nothing renders without patterns', async () => {
        const onDismiss = vi.fn(async () => {});
        const showToast = vi.fn();
        useAppStore.setState({ showToast });
        show(<YourPatterns patterns={[streak]} onDismiss={onDismiss} onRestore={vi.fn()} />);
        fireEvent.click(screen.getByTestId('pattern-hide'));
        await waitFor(() => expect(onDismiss).toHaveBeenCalledWith(streak.key));
        expect(showToast.mock.calls[0][2].action.label).toBe('Undo');
        cleanup();
        const { container } = show(<YourPatterns patterns={[]} onDismiss={vi.fn()} onRestore={vi.fn()} />);
        expect(container.innerHTML).toBe('');
    });

    it('general tips render under their label, nothing for none', () => {
        show(<GeneralTips tips={['Plan treats on purpose.']} />);
        expect(screen.getByTestId('general-tips').textContent).toMatch(/General tips — not from your data.*Plan treats on purpose\./);
        cleanup();
        const { container } = show(<GeneralTips tips={[]} />);
        expect(container.innerHTML).toBe('');
    });
});
