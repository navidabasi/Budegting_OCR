import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WaysToSave from '../WaysToSave';
import VerdictStrip, { ownVerdict } from '../VerdictStrip';
import WhereMoneyWent from '../WhereMoneyWent';
import { computeOpportunities } from '../../../services/savingsOpportunities';
import { explanationsFor, topCategories, winsAndWatchouts } from '../../../services/insightsView';
import { verdictFigures } from '../../../services/insightsAggregates';
import { ownerLike, TODAY } from '../../../services/__fixtures__/ownerLike';
import { currentCyclePeriod, normalizeConfig } from '../../../utils/payCycle';
import { useAppStore } from '../../../store/appStore';

vi.mock('../../../data/hooks', async (orig) => ({ ...(await orig()), useSettings: () => ({ defaultCurrency: 'EUR' }) }));

const d = ownerLike();
const period = currentCyclePeriod(normalizeConfig(d.config), new Date(`${TODAY}T12:00:00Z`));
const opp = computeOpportunities({ ...d, period });
const show = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
const cards = (props = {}) => show(<WaysToSave opportunities={opp.top} explanations={new Map()} transactions={d.transactions} accounts={d.accounts} goals={d.goals} periodSpec="c:2026-10" onDismiss={vi.fn(async () => {})} onRestore={vi.fn()} {...props} />);

afterEach(cleanup);

describe('Ways to save', () => {
    it('shows at most five cards, each with its saving, one action and Not useful', () => {
        cards();
        const list = screen.getAllByTestId('opportunity');
        expect(list.map((c) => c.dataset.kind)).toEqual(opp.top.map((o) => o.kind));
        expect(list.length).toBeLessThanOrEqual(5);
        for (const c of list) {
            expect(within(c).getAllByTestId('opportunity-action')).toHaveLength(1);
            expect(within(c).getByTestId('opportunity-dismiss').textContent).toBe('Not useful');
        }
        expect(within(list[0]).getByRole('heading').textContent).toMatch(/^79[.,]00\s€ more on Dining than usual$/);
        expect(within(list[0]).getByTestId('opportunity-monthly').textContent).toMatch(/79[.,]00/);
        expect(screen.getByTestId('save-total').textContent).toMatch(/^up to 129[.,]67\s€ a month$/);
    });
    it('actions lead where the card says: prefilled budget, the exact list, the prefilled transfer to the goal', () => {
        const openQuickAdd = vi.fn();
        useAppStore.setState({ openQuickAdd });
        cards();
        const byKind = (k) => screen.getAllByTestId('opportunity').find((c) => c.dataset.kind === k);
        expect(within(byKind('category_above_baseline')).getByTestId('opportunity-action').getAttribute('href')).toBe('/plan?m=c%3A2026-10&budget=Dining&amount=35');
        expect(within(byKind('merchant_frequency')).getByTestId('opportunity-action').getAttribute('href')).toBe('/activity?m=r%3A2026-10-27..2026-11-12&merchant=tabaccheria+centrale');
        expect(within(byKind('uncategorised_blind_spot')).getByTestId('opportunity-action').getAttribute('href')).toBe('/activity?m=r%3A2026-10-27..2026-11-12&uncat=1');
        fireEvent.click(within(byKind('goal_boost')).getByTestId('opportunity-action'));
        expect(openQuickAdd).toHaveBeenCalledWith({ initial: expect.objectContaining({ transactionType: 'transfer', goalId: 'goal-1', total: 79, toAccountId: 'a-save', accountId: 'a-main' }) });
    });
    it('"Why?" opens the working, the period, the confidence and the receipts behind the card, and collapses again', () => {
        cards();
        const card = screen.getAllByTestId('opportunity')[0];
        const why = within(card).getByTestId('opportunity-why');
        expect(why.getAttribute('aria-expanded')).toBe('false');
        expect(within(card).queryByTestId('opportunity-details')).toBeNull();
        fireEvent.click(why);
        expect(why.getAttribute('aria-expanded')).toBe('true');
        const details = within(card).getByTestId('opportunity-details');
        expect(details.textContent).toContain('middle value of your last 3 periods');
        expect(details.textContent).toContain('High confidence');
        const records = within(details).getAllByTestId('opportunity-record');
        expect(records).toHaveLength(5);
        expect(records[0].getAttribute('href')).toMatch(/^\/receipts\/s\d+$/);
        fireEvent.click(why);
        expect(within(card).queryByTestId('opportunity-details')).toBeNull();
    });
    it('"Not useful" reports the key once; the hidden ones can be shown again', async () => {
        const onDismiss = vi.fn(async () => {});
        const onRestore = vi.fn();
        cards({ onDismiss, onRestore, hiddenCount: 2 });
        fireEvent.click(within(screen.getAllByTestId('opportunity')[0]).getByTestId('opportunity-dismiss'));
        await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('category_above_baseline:Dining'));
        expect(screen.getByTestId('save-hidden').textContent).toContain('2 hidden as not useful');
        fireEvent.click(screen.getByRole('button', { name: 'Show again' }));
        expect(onRestore).toHaveBeenCalled();
    });
    it('uses the AI sentence only while its figures match the card; otherwise the app wording', () => {
        const narrative = { v: 2, opportunities: [{ id: 'O1', explanation: 'Dining is €79 above your usual €21.50 so far.', howTo: 'Try a €35 budget.' }, { id: 'O3', explanation: 'You went 9 times and spent €61.' }] };
        const refs = { O1: opp.top[0].key, O3: opp.top[2].key };
        const explanations = explanationsFor(opp.top, narrative, refs);
        expect([...explanations.keys()]).toEqual([opp.top[0].key]);
        cards({ explanations });
        const list = screen.getAllByTestId('opportunity');
        expect(within(list[0]).getByTestId('opportunity-explanation').textContent).toBe('Dining is €79 above your usual €21.50 so far.');
        expect(within(list[0]).getByTestId('opportunity-ai')).toBeTruthy();
        expect(within(list[2]).getByTestId('opportunity-explanation').textContent).toMatch(/^About 6[.,]00\s€ each time\. One fewer visit a week adds up to 24[.,]00\s€ a month\.$/);
        expect(within(list[2]).queryByTestId('opportunity-ai')).toBeNull();
    });
    it('explains itself when there is nothing to suggest', () => {
        cards({ opportunities: [] });
        expect(screen.getByTestId('save-empty').textContent).toContain('Nothing to suggest for this period yet');
    });
});

describe('Verdict strip and category bars', () => {
    const figures = verdictFigures({ ...d, period });
    it('shows the three figures and, without AI, the app writes the sentence', () => {
        show(<VerdictStrip figures={figures} narrative={{ status: 'notConfigured', data: null, stale: false }} />);
        expect(screen.getByTestId('verdict-headline').textContent).toMatch(/spent so far: .* (more|less) than at this point last period\.$/);
        expect(screen.getByTestId('verdict-change').textContent).toContain('vs same point last period');
        expect(screen.getByText('15 days left')).toBeTruthy();
        expect(screen.getByTestId('narrative-notConfigured').textContent).toContain('computed by the app');
    });
    it('shows the AI verdict, and labels it out of date with an update button instead of regenerating', () => {
        const onUpdate = vi.fn();
        show(<VerdictStrip figures={figures} narrative={{ status: 'ready', data: { verdict: 'Dining is the story of this period.', summary: 'S.', generatedAt: '2026-11-12T08:00:00Z', model: 'm' }, stale: true }} onUpdate={onUpdate} />);
        expect(screen.getByTestId('verdict-headline').textContent).toBe('Dining is the story of this period.');
        fireEvent.click(within(screen.getByTestId('narrative-stale')).getByRole('button'));
        expect(onUpdate).toHaveBeenCalled();
    });
    it('the first period on record is not compared with anything', () => {
        const t = (k, p = {}) => `${k}:${p.spent || ''}`;
        expect(ownVerdict({ basis: 'elapsed', spent: 10, change: null }, { t, money: (n) => `€${n}` })).toBe('insights.verdict.firstRunning:€10');
        expect(ownVerdict({ basis: 'completed', spent: 10, change: -5 }, { t, money: (n) => `€${n}` })).toBe('insights.verdict.lessDone:€10');
    });
    it('top categories: five at most, like for like with the previous period, linking to the Breakdown of the same period', () => {
        const view = topCategories({ ...d, period });
        expect(view.rows).toHaveLength(5);
        expect(view).toMatchObject({ comparable: true, running: true });
        expect(view.rows[0].category).toBe('Housing');
        const dining = view.rows.find((r) => r.category === 'Dining');
        expect(dining.amount).toBe(100.5);
        expect(dining.delta).toBeCloseTo(dining.amount - dining.previous, 2);
        expect(view.rows.reduce((s, r) => s + r.pct, 0)).toBeLessThanOrEqual(100);
        show(<WhereMoneyWent view={view} periodSpec="c:2026-10" />);
        expect(screen.getByTestId('where-link').getAttribute('href')).toBe('/breakdown?m=c%3A2026-10');
        expect(screen.getAllByTestId('where-row')).toHaveLength(5);
        expect(topCategories({ ...d, period: '2025-12', today: TODAY }).rows[0].previous).toBeNull();
    });
});

describe('wins and watch-outs', () => {
    const findings = [
        { id: 'a', severity: 'positive', title: 'W', body: 'wb' },
        { id: 'b', severity: 'high', title: 'H', body: 'hb' },
        { id: 'c', severity: 'low', title: 'L', body: 'lb' },
    ];
    const findingText = (f) => ({ title: f.title, body: f.body });
    it('come from the app findings when there is no current AI summary', () => {
        const own = winsAndWatchouts({ findings, narrative: null, findingText });
        expect(own).toEqual({ wins: [{ text: 'W', detail: 'wb', findingId: 'a', opportunityKey: null }], watchouts: [{ text: 'H', detail: 'hb', findingId: 'b', opportunityKey: null }] });
        const ai = { v: 2, wins: [{ text: 'AI win', ref: 'N1' }], watchouts: [{ text: 'AI watch', ref: 'O1' }] };
        expect(winsAndWatchouts({ findings, narrative: ai, refs: { N1: 'a', O1: 'k' }, stale: true, findingText })).toEqual(own);
    });
    it('AI notes link to the finding or card they name; unknown refs carry no link', () => {
        const ai = { v: 2, wins: [{ text: 'AI win', ref: 'N1' }, { text: 'Loose', ref: 'N9' }], watchouts: [{ text: 'AI watch', ref: 'O1' }] };
        const out = winsAndWatchouts({ findings, narrative: ai, refs: { N1: 'a', O1: 'category_above_baseline:Dining' }, findingText });
        expect(out.wins).toEqual([{ text: 'AI win', detail: null, findingId: 'a', opportunityKey: null }, { text: 'Loose', detail: null, findingId: null, opportunityKey: null }]);
        expect(out.watchouts[0]).toMatchObject({ opportunityKey: 'category_above_baseline:Dining' });
    });
});
