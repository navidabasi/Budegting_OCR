import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../data/api', () => ({
    isConfigured: vi.fn(() => false),
    isMissingTableError: vi.fn(() => false),
    isTransientError: vi.fn(() => false),
    insert: vi.fn(async (_t, rec) => rec),
    update: vi.fn(async () => null),
    upsert: vi.fn(),
    remove: vi.fn(),
    fetchUpdatedAt: vi.fn(),
    fetchOne: vi.fn(),
    fetchSince: vi.fn(async () => []),
    fetchIds: vi.fn(async () => []),
    fetchPage: vi.fn(async () => ({ rows: [], next: null })),
    PULL_PAGE: 50,
}));
import ChatHistorySheet from '../ChatHistorySheet';
import Toast from '../../common/Toast';
import { db, openDb } from '../../../data/db';
import { queryClient } from '../../../data/queryClient';
import { useAppStore } from '../../../store/appStore';
import { getOpenConversationId } from '../../../services/chatPrefs';

// jsdom has no PointerEvent: a MouseEvent that carries pointerType is enough for the swipe
if (!window.PointerEvent) {
    window.PointerEvent = class extends MouseEvent {
        constructor(type, init = {}) {
            super(type, init);
            this.pointerType = init.pointerType;
        }
    };
}
const iso = (n) => new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString();
const seed = async (n) => {
    await db.chatConversations.bulkPut(Array.from({ length: n }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}`, userId: 'u', title: `Chat ${i}`, createdAt: iso(i), updatedAt: iso(i), deletedAt: null })));
    await db.chatMessages.bulkPut(Array.from({ length: n }, (_, i) => ({ id: `m${i}`, userId: 'u', conversationId: `c${String(i).padStart(2, '0')}`, role: 'user', content: `q${i}`, meta: null, createdAt: iso(i), updatedAt: iso(i), deletedAt: null })));
};
const mount = (onClose = vi.fn()) => render(<QueryClientProvider client={queryClient}><ChatHistorySheet open onClose={onClose} /><Toast /></QueryClientProvider>);

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    queryClient.clear();
    localStorage.clear();
    useAppStore.setState({ currentUser: { userId: 'u' }, toast: null });
});
afterEach(cleanup);

describe('ChatHistorySheet', () => {
    it('lists the newest 20 with title, date and message count, and "Load more" brings the rest', async () => {
        await seed(25);
        mount();
        await waitFor(() => expect(screen.getAllByTestId('chat-history-item')).toHaveLength(20));
        const first = screen.getAllByTestId('chat-history-item')[0];
        expect(first.textContent).toMatch(/Chat 24/);
        expect(first.textContent).toMatch(/1 message/);
        expect(first.textContent).toMatch(/2026/);
        fireEvent.click(screen.getByTestId('chat-history-more'));
        await waitFor(() => expect(screen.getAllByTestId('chat-history-item')).toHaveLength(25));
        expect(screen.queryByTestId('chat-history-more')).toBeNull();
    });

    it('opens a chat (remembered) and closes the sheet; New chat clears the remembered one', async () => {
        await seed(3);
        const onClose = vi.fn();
        mount(onClose);
        fireEvent.click((await screen.findAllByTestId('chat-history-item'))[1]);
        expect(getOpenConversationId('u')).toBe('c01');
        expect(onClose).toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('chat-history-new'));
        expect(getOpenConversationId('u')).toBeNull();
    });

    it('deletes with an undo toast; undo brings the chat back', async () => {
        await seed(2);
        mount();
        await screen.findAllByTestId('chat-history-item');
        fireEvent.click(screen.getAllByTestId('chat-history-delete')[0]);
        await waitFor(() => expect(screen.getAllByTestId('chat-history-item')).toHaveLength(1));
        expect(await db.chatConversations.count()).toBe(2); // soft: still there
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(screen.getAllByTestId('chat-history-item')).toHaveLength(2));
    });

    it('swipe deletes too', async () => {
        await seed(2);
        mount();
        const row = (await screen.findAllByTestId('chat-row'))[0];
        fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 200, clientY: 100 });
        fireEvent.pointerMove(row, { pointerType: 'touch', clientX: 90, clientY: 102 });
        fireEvent.pointerUp(row, { pointerType: 'touch', clientX: 90, clientY: 102 });
        await waitFor(() => expect(screen.getAllByTestId('chat-history-item')).toHaveLength(1));
    });

    it('"Delete all chat history" asks first (no confirm()), then soft-deletes everything', async () => {
        await seed(3);
        const confirmSpy = vi.spyOn(window, 'confirm');
        mount();
        await screen.findAllByTestId('chat-history-item');
        fireEvent.click(screen.getByTestId('chat-history-delete-all'));
        const dialog = await screen.findByRole('dialog', { name: 'Delete all chat history?' });
        expect(await db.chatConversations.filter((c) => !c.deletedAt).count()).toBe(3); // nothing yet
        fireEvent.click(within(dialog).getByTestId('delete-all-confirm'));
        await waitFor(async () => expect(await db.chatConversations.filter((c) => !c.deletedAt).count()).toBe(0));
        expect(await db.chatMessages.filter((m) => !m.deletedAt).count()).toBe(0);
        expect(confirmSpy).not.toHaveBeenCalled();
        await screen.findByText(/No saved chats yet/);
    });
});
