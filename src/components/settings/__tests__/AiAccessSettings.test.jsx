import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const state = { access: null, admin: null };
vi.mock('../../../hooks/useAiAccess', () => ({ useAiAccess: () => state.access, useAiAccessAdmin: () => state.admin }));
import AiAccessSettings from '../AiAccessSettings';
import { useAppStore } from '../../../store/appStore';

afterEach(cleanup);
const base = { known: true, loading: false, refresh: vi.fn() };

describe('Settings: AI access', () => {
    it('a waiting account sees the notice and no admin list', () => {
        state.access = { ...base, status: 'pending', isAdmin: false, allowed: false };
        state.admin = { accounts: [], loading: false, error: null, decide: vi.fn(), deciding: null };
        render(<AiAccessSettings />);
        expect(screen.getByTestId('ai-locked').dataset.status).toBe('pending');
        expect(screen.getByText('AI features are waiting for approval')).toBeTruthy();
        expect(screen.queryByTestId('ai-access-admin')).toBeNull();
    });

    it('the admin approves a waiting account and can revoke an approved one; the admin row has no buttons', async () => {
        const decide = vi.fn(async () => {});
        useAppStore.setState({ showToast: vi.fn() });
        state.access = { ...base, status: 'approved', isAdmin: true, allowed: true };
        state.admin = {
            loading: false, error: null, deciding: null, decide,
            accounts: [
                { userId: 'me', email: 'owner@example.com', status: 'approved', isAdmin: true, callsToday: 4 },
                { userId: 'b', email: 'new@example.com', status: 'pending', isAdmin: false, callsToday: 0 },
                { userId: 'a', email: 'friend@example.com', status: 'approved', isAdmin: false, callsToday: 2 },
            ],
        };
        render(<AiAccessSettings />);
        expect(screen.getByText('You are the admin: you approve who can use AI features.')).toBeTruthy();
        const rows = screen.getAllByTestId('ai-access-row');
        expect(rows.map((r) => r.dataset.status)).toEqual(['admin', 'pending', 'approved']);
        expect(within(rows[0]).queryAllByRole('button')).toHaveLength(0);
        expect(within(rows[2]).getByText('2 AI calls today')).toBeTruthy();
        fireEvent.click(within(rows[1]).getByRole('button', { name: 'Approve' }));
        await waitFor(() => expect(decide).toHaveBeenCalledWith({ userId: 'b', status: 'approved' }));
        fireEvent.click(within(rows[2]).getByRole('button', { name: 'Revoke' }));
        await waitFor(() => expect(decide).toHaveBeenCalledWith({ userId: 'a', status: 'denied' }));
    });

    it('nothing renders while the status cannot be known (offline, no backend)', () => {
        state.access = { ...base, known: false, status: 'unknown', isAdmin: false, allowed: true };
        const { container } = render(<AiAccessSettings />);
        expect(container.innerHTML).toBe('');
    });
});
