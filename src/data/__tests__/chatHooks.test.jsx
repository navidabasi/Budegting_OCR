import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

vi.mock('../api', () => ({
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

import { db, openDb } from '../db';
import { queryClient } from '../queryClient';
import { useAppStore } from '../../store/appStore';
import { useConversations, useConversationMessages, useChatActions } from '../hooks';

const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
const iso = (n) => new Date(Date.UTC(2026, 10, 11, 10, 0, n)).toISOString();

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    queryClient.clear();
    useAppStore.setState({ currentUser: { userId: 'u1' } });
});

describe('chat hooks', () => {
    it('lists the 20 newest conversations and loads more on request', async () => {
        await db.chatConversations.bulkPut(Array.from({ length: 45 }, (_, i) => ({ id: `c${i}`, userId: 'u1', title: `t${i}`, createdAt: iso(i), updatedAt: iso(i), deletedAt: null })));
        const { result } = renderHook(() => useConversations(), { wrapper });
        await waitFor(() => expect(result.current.conversations).toHaveLength(20));
        expect(result.current.conversations[0].title).toBe('t44');
        expect(result.current.hasMore).toBe(true);
        await act(async () => { await result.current.loadMore(); });
        await waitFor(() => expect(result.current.conversations).toHaveLength(40));
        await act(async () => { await result.current.loadMore(); });
        await waitFor(() => expect(result.current.conversations).toHaveLength(45));
        expect(result.current.hasMore).toBe(false);
        expect(new Set(result.current.conversations.map((c) => c.id)).size).toBe(45);
    });

    it('opens on the newest 30 messages, loads older ones on demand and appends without reloading older pages', async () => {
        await db.chatMessages.bulkPut(Array.from({ length: 70 }, (_, i) => ({ id: `m${String(i).padStart(2, '0')}`, userId: 'u1', conversationId: 'c', role: 'user', content: `#${i}`, createdAt: iso(i), updatedAt: iso(i), deletedAt: null })));
        await db.chatConversations.put({ id: 'c', userId: 'u1', title: 't', createdAt: iso(0), updatedAt: iso(70), deletedAt: null });
        const { result } = renderHook(() => ({ m: useConversationMessages('c'), a: useChatActions() }), { wrapper });
        await waitFor(() => expect(result.current.m.messages).toHaveLength(30));
        expect(result.current.m.messages[0].content).toBe('#40');
        expect(result.current.m.hasOlder).toBe(true);
        await act(async () => { await result.current.m.loadOlder(); });
        await waitFor(() => expect(result.current.m.messages).toHaveLength(60));
        expect(result.current.m.messages[0].content).toBe('#10');
        await act(async () => { await result.current.a.appendMessage({ conversationId: 'c', role: 'assistant', content: 'new' }); });
        await waitFor(() => expect(result.current.m.messages).toHaveLength(61));
        expect(result.current.m.messages[60].content).toBe('new');
        expect(result.current.m.messages[0].content).toBe('#10'); // window did not slide
        await act(async () => { await result.current.m.loadOlder(); });
        await waitFor(() => expect(result.current.m.messages).toHaveLength(71));
        expect(result.current.m.hasOlder).toBe(false);
    });
});
