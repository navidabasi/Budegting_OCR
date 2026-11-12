import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const state = { access: null, admin: null };
vi.mock('../../../hooks/useAiAccess', () => ({ useAiAccess: () => state.access, useAiAccessAdmin: () => state.admin }));
import AiAccessSettings from '../AiAccessSettings';
import { useAppStore } from '../../../store/appStore';

afterEach(cleanup);
const base = { known: true, loading: false, refresh: vi.fn() };
const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
const many = (n, status) => Array.from({ length: n }, (_, i) => ({ userId: `${status}${i}`, email: `${status}${i}@example.com`, status, isAdmin: false, callsToday: i % 3, requestedAt: day(i + 1), decidedAt: status === 'pending' ? null : day(1) }));
const adminState = (accounts, decide = vi.fn(async ({ userIds }) => ({ done: userIds.length, failed: 0 }))) => ({ loading: false, error: null, busyIds: [], decide, accounts: [{ userId: 'me', email: 'owner@example.com', status: 'approved', isAdmin: true, callsToday: 4, requestedAt: day(300) }, ...accounts] });

describe('Settings: AI access', () => {
    it('a waiting account sees the notice and no admin queue', () => {
        state.access = { ...base, status: 'pending', isAdmin: false, allowed: false };
        state.admin = adminState([]);
        render(<AiAccessSettings />);
        expect(screen.getByTestId('ai-locked').dataset.status).toBe('pending');
        expect(screen.queryByTestId('ai-access-admin')).toBeNull();
    });

    it('the admin sees the queue in one line, not the whole list', () => {
        state.access = { ...base, status: 'approved', isAdmin: true, allowed: true };
        state.admin = adminState([...many(12, 'pending'), ...many(3, 'approved'), ...many(1, 'denied')]);
        render(<AiAccessSettings />);
        const queue = screen.getByTestId('ai-access-admin');
        expect(within(queue).getByTestId('ai-access-waiting').textContent).toBe('12');
        expect(queue.textContent).toMatch(/12 waiting for approval/);
        expect(queue.textContent).toMatch(/3 approved · 1 denied/);
        expect(screen.queryAllByTestId('ai-access-row')).toHaveLength(0);
    });

    it('the review sheet: tabs with counts, search, one action per row, bulk approve of everyone waiting', async () => {
        const decide = vi.fn(async ({ userIds }) => ({ done: userIds.length, failed: 0 }));
        const showToast = vi.fn();
        useAppStore.setState({ showToast });
        state.access = { ...base, status: 'approved', isAdmin: true, allowed: true };
        state.admin = adminState([...many(12, 'pending'), ...many(3, 'approved')], decide);
        render(<AiAccessSettings />);
        fireEvent.click(screen.getByTestId('ai-access-admin'));
        const sheet = await screen.findByTestId('ai-access-sheet');
        expect(within(sheet).getByTestId('ai-tab-pending').getAttribute('aria-selected')).toBe('true');
        expect(within(sheet).getByTestId('ai-tab-pending').textContent).toMatch(/Waiting\s*12/);
        expect(within(sheet).getByTestId('ai-tab-approved').textContent).toMatch(/Approved\s*4/); // 3 + the admin
        expect(within(sheet).getAllByTestId('ai-access-row')).toHaveLength(12);
        // search narrows the list
        fireEvent.change(within(sheet).getByTestId('ai-access-search'), { target: { value: 'pending1' } });
        expect(within(sheet).getAllByTestId('ai-access-row').map((r) => r.textContent)).toEqual([expect.stringMatching(/pending1@/), expect.stringMatching(/pending10@/), expect.stringMatching(/pending11@/)]);
        fireEvent.change(within(sheet).getByTestId('ai-access-search'), { target: { value: '' } });
        // one row: approve directly
        fireEvent.click(within(sheet).getAllByTestId('ai-row-primary')[0]);
        await waitFor(() => expect(decide).toHaveBeenCalledWith({ userIds: ['pending0'], status: 'approved' }));
        // select all, then one decision for all of them from the sticky bar
        fireEvent.click(within(sheet).getByTestId('ai-select-all'));
        expect(within(sheet).getByTestId('ai-bulk-primary').textContent).toBe('Approve 12');
        expect(within(sheet).queryAllByTestId('ai-row-primary')).toHaveLength(0); // per-row buttons step aside while selecting
        fireEvent.click(within(sheet).getByTestId('ai-bulk-primary'));
        await waitFor(() => expect(decide).toHaveBeenLastCalledWith({ userIds: expect.arrayContaining(['pending0', 'pending11']), status: 'approved' }));
        expect(decide.mock.lastCall[0].userIds).toHaveLength(12);
        await waitFor(() => expect(showToast).toHaveBeenLastCalledWith('12 accounts updated', 'success'));
    });

    it('approved tab: the admin row has no actions, others can be revoked', () => {
        state.access = { ...base, status: 'approved', isAdmin: true, allowed: true };
        state.admin = adminState(many(2, 'approved'));
        render(<AiAccessSettings />);
        fireEvent.click(screen.getByTestId('ai-access-admin'));
        const rows = screen.getAllByTestId('ai-access-row');
        expect(rows.map((r) => r.dataset.status)).toEqual(['admin', 'approved', 'approved']);
        expect(within(rows[0]).queryAllByRole('button')).toHaveLength(0);
        expect(within(rows[1]).getByTestId('ai-row-primary').textContent).toBe('Revoke');
    });

    it('long lists render 50 at a time', () => {
        state.access = { ...base, status: 'approved', isAdmin: true, allowed: true };
        state.admin = adminState(many(120, 'pending'));
        render(<AiAccessSettings />);
        fireEvent.click(screen.getByTestId('ai-access-admin'));
        expect(screen.getAllByTestId('ai-access-row')).toHaveLength(50);
        fireEvent.click(screen.getByRole('button', { name: 'Show 70 more' }));
        expect(screen.getAllByTestId('ai-access-row')).toHaveLength(100);
    });

    it('nothing renders while the status cannot be known', () => {
        state.access = { ...base, known: false, status: 'unknown', isAdmin: false, allowed: true };
        const { container } = render(<AiAccessSettings />);
        expect(container.innerHTML).toBe('');
    });
});
