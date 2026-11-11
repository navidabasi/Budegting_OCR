import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// A tiny in-memory "server" for the chat tables: keyset pages ordered by (updatedAt, id), exactly what api.fetchPage promises.
const server = { chatConversations: new Map(), chatMessages: new Map() };
const keyset = (rows, after, limit) => {
    const sorted = [...rows].sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.id < b.id ? -1 : 1));
    const part = after ? sorted.filter((r) => r.updatedAt > after.updatedAt || (r.updatedAt === after.updatedAt && r.id > after.id)) : sorted;
    const rows2 = part.slice(0, limit).map((r) => ({ ...r }));
    const last = rows2[rows2.length - 1];
    return { rows: rows2, next: rows2.length >= limit && last ? { updatedAt: last.updatedAt, id: last.id } : null };
};
let onPage = null;

vi.mock('../api', () => ({
    isConfigured: vi.fn(() => true),
    isMissingTableError: vi.fn(() => false),
    isTransientError: vi.fn((e) => e?.message === 'Failed to fetch'),
    insert: vi.fn(async (t, rec) => { server[t].set(rec.id, { ...rec }); return rec; }),
    update: vi.fn(async (t, id, patch) => { const row = { ...server[t].get(id), ...patch }; server[t].set(id, row); return row; }),
    upsert: vi.fn(async (_t, rec) => rec),
    remove: vi.fn(),
    removeGroup: vi.fn(),
    fetchUpdatedAt: vi.fn(async (t, id) => server[t].get(id)?.updatedAt || null),
    fetchOne: vi.fn(async (t, id) => server[t].get(id) || null),
    fetchSince: vi.fn(async () => []),
    fetchIds: vi.fn(async () => []),
    PULL_PAGE: 3,
    fetchPage: vi.fn(async (t, _u, after, limit) => {
        const page = keyset([...server[t].values()], after, limit);
        if (onPage) await onPage(t, page);
        return page;
    }),
}));
vi.mock('../queryClient', () => ({ notifyDataChanged: vi.fn(), queryClient: {} }));

import * as api from '../api';
import { db, openDb, getMeta, setMeta } from '../db';
import { __resetSyncForTests, flushOutbox, pullTable, pullAll } from '../sync';
import * as repo from '../repo';

const USER = 'u1';
const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
const iso = (n) => new Date(Date.UTC(2026, 10, 11, 10, 0, n)).toISOString();

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    server.chatConversations.clear();
    server.chatMessages.clear();
    onPage = null;
    __resetSyncForTests();
    vi.clearAllMocks();
    setOnline(true);
});

describe('schema upgrade', () => {
    it('declares the chat tables and indexes', () => {
        expect(db.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['chatConversations', 'chatMessages', 'transactions', 'outbox']));
        expect(db.table('chatMessages').schema.idxByName['[conversationId+createdAt]']).toBeTruthy();
        expect(db.table('chatMessages').schema.idxByName['[userId+updatedAt]']).toBeTruthy();
        expect(db.table('chatConversations').schema.idxByName['[userId+updatedAt]']).toBeTruthy();
    });
});

describe('offline append then flush', () => {
    it('queues a conversation and its messages offline, keeps them readable, flushes in order on reconnect', async () => {
        setOnline(false);
        const conv = await repo.createConversation(USER, { title: `  ${'x'.repeat(80)}  ` });
        expect(conv.title).toHaveLength(60);
        const a = await repo.appendMessage(USER, { conversationId: conv.id, role: 'user', content: 'hi' });
        const b = await repo.appendMessage(USER, { conversationId: conv.id, role: 'assistant', content: 'hello', meta: { ev: { citations: ['F1'] } } });
        expect(a.createdAt < b.createdAt).toBe(true); // strictly increasing even inside one millisecond
        expect((await repo.listMessagesPage(conv.id)).items.map((m) => m.role)).toEqual(['user', 'assistant']);
        expect(api.insert).not.toHaveBeenCalled();
        expect(await db.outbox.count()).toBeGreaterThan(0);

        setOnline(true);
        const res = await flushOutbox(USER);
        expect(res.errors).toEqual([]);
        expect(await db.outbox.count()).toBe(0);
        expect([...server.chatMessages.keys()].sort()).toEqual([a.id, b.id].sort());
        expect(server.chatMessages.get(b.id).meta).toEqual({ ev: { citations: ['F1'] } });
        expect(server.chatConversations.get(conv.id).title).toHaveLength(60);
        // inserts go through the idempotent client-id upsert: flushing again changes nothing
        await flushOutbox(USER);
        expect(server.chatMessages.size).toBe(2);
    });
});

describe('soft delete', () => {
    it('hides the conversation and its messages, syncs deletedAt, and can be undone', async () => {
        const conv = await repo.createConversation(USER, { title: 'A' });
        const other = await repo.createConversation(USER, { title: 'B' });
        await repo.appendMessage(USER, { conversationId: conv.id, role: 'user', content: 'q' });
        await repo.appendMessage(USER, { conversationId: conv.id, role: 'assistant', content: 'a' });
        await repo.appendMessage(USER, { conversationId: other.id, role: 'user', content: 'keep' });
        await flushOutbox(USER);

        const r = await repo.deleteConversation(conv.id);
        expect(r.messages).toBe(2);
        expect((await repo.listConversationsPage(USER)).items.map((c) => c.title)).toEqual(['B']);
        expect((await repo.listMessagesPage(conv.id)).items).toEqual([]);
        expect((await repo.listMessagesPage(other.id)).items).toHaveLength(1);
        // rows stay (soft): never hard-deleted by the client
        expect(await db.chatMessages.count()).toBe(3);
        await flushOutbox(USER);
        expect(api.remove).not.toHaveBeenCalled();
        expect(server.chatConversations.get(conv.id).deletedAt).toBeTruthy();
        expect([...server.chatMessages.values()].filter((m) => m.conversationId === conv.id).every((m) => m.deletedAt)).toBe(true);

        expect(await repo.restoreConversation(conv.id)).toBe(true);
        expect((await repo.listConversationsPage(USER)).items.map((c) => c.title).sort()).toEqual(['A', 'B']);
        expect((await repo.listMessagesPage(conv.id)).items).toHaveLength(2);
        await flushOutbox(USER);
        expect(server.chatConversations.get(conv.id).deletedAt).toBeNull();
    });

    it('deleteAllConversations hides everything, offline too, and syncs later', async () => {
        setOnline(false);
        for (const t of ['A', 'B', 'C']) {
            const c = await repo.createConversation(USER, { title: t });
            await repo.appendMessage(USER, { conversationId: c.id, role: 'user', content: t });
        }
        expect(await repo.deleteAllConversations(USER)).toBe(3);
        expect((await repo.listConversationsPage(USER)).items).toEqual([]);
        setOnline(true);
        await flushOutbox(USER);
        expect([...server.chatConversations.values()].every((c) => c.deletedAt)).toBe(true);
        expect([...server.chatMessages.values()].every((m) => m.deletedAt)).toBe(true);
    });

    it('a deleted conversation arriving from another device disappears from the list on pull', async () => {
        const conv = await repo.createConversation(USER, { title: 'Remote' });
        await flushOutbox(USER);
        server.chatConversations.set(conv.id, { ...server.chatConversations.get(conv.id), deletedAt: iso(50), updatedAt: iso(50) });
        await pullAll(USER);
        expect((await repo.listConversationsPage(USER)).items).toEqual([]);
    });
});

describe('keyset reads from the mirror', () => {
    it('pages conversations newest first without duplicates or gaps, ties included', async () => {
        const rows = [];
        for (let i = 0; i < 45; i++) rows.push({ id: `c${String(i).padStart(2, '0')}`, userId: USER, title: `t${i}`, createdAt: iso(0), updatedAt: iso(Math.floor(i / 5)), deletedAt: null }); // 5 rows share each timestamp
        rows.push({ id: 'zz', userId: USER, title: 'gone', createdAt: iso(0), updatedAt: iso(30), deletedAt: iso(31) });
        await db.chatConversations.bulkPut(rows);
        const seen = [];
        let after = null;
        let pages = 0;
        do {
            const p = await repo.listConversationsPage(USER, { limit: 20, after });
            seen.push(...p.items.map((c) => c.id));
            after = p.next;
            pages++;
        } while (after);
        expect(pages).toBe(3);
        expect(seen).toHaveLength(45);
        expect(new Set(seen).size).toBe(45);
        expect(seen).not.toContain('zz');
        const expected = rows.filter((r) => !r.deletedAt).sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? 1 : -1) : a.updatedAt < b.updatedAt ? 1 : -1)).map((r) => r.id);
        expect(seen).toEqual(expected);
    });

    it('opens on the newest 30 messages and loads older pages with stable boundaries (equal timestamps)', async () => {
        const msgs = Array.from({ length: 75 }, (_, i) => ({ id: `m${String(i).padStart(3, '0')}`, userId: USER, conversationId: 'c', role: i % 2 ? 'assistant' : 'user', content: `#${i}`, meta: null, createdAt: iso(Math.floor(i / 3)), updatedAt: iso(0), deletedAt: null }));
        await db.chatMessages.bulkPut([...msgs, { id: 'x', userId: USER, conversationId: 'other', role: 'user', content: 'o', createdAt: iso(1), updatedAt: iso(1) }]);
        const first = await repo.listMessagesPage('c', { limit: 30 });
        expect(first.items.map((m) => m.content)).toEqual(msgs.slice(45).map((m) => m.content));
        expect(first.hasOlder).toBe(true);
        const second = await repo.listMessagesPage('c', { limit: 30, before: first.items[0] });
        expect(second.items.map((m) => m.content)).toEqual(msgs.slice(15, 45).map((m) => m.content));
        const third = await repo.listMessagesPage('c', { limit: 30, before: second.items[0] });
        expect(third.items).toHaveLength(15);
        expect(third.hasOlder).toBe(false);
        // everything from an anchor to the newest, including a message appended afterwards
        const appended = await repo.listMessagesFrom('c', second.items[0]);
        expect(appended.items).toHaveLength(60);
        expect(appended.hasOlder).toBe(true);
    });
});

describe('paged, resumable pull', () => {
    const seed = (n, t = 'chatMessages') => {
        for (let i = 0; i < n; i++) server[t].set(`r${String(i).padStart(3, '0')}`, { id: `r${String(i).padStart(3, '0')}`, userId: USER, conversationId: 'c', role: 'user', content: `${i}`, createdAt: iso(i), updatedAt: iso(Math.floor(i / 4)), deletedAt: null }); // ties on updatedAt
    };

    it('pulls in pages of PULL_PAGE and gets every row once', async () => {
        seed(10);
        const out = await pullTable(USER, 'chatMessages');
        expect(out.downloaded).toBe(10);
        expect(api.fetchPage.mock.calls.length).toBe(4); // 3+3+3+1
        expect(await db.chatMessages.count()).toBe(10);
    });

    it('does not duplicate or skip rows when rows are inserted while paging', async () => {
        seed(9);
        let injected = false;
        onPage = async (_t, page) => {
            if (injected) return;
            injected = true;
            // arrives mid-pull: sorts before the cursor (older updatedAt, id between) and after it
            server.chatMessages.set('zz-late', { id: 'zz-late', userId: USER, conversationId: 'c', role: 'user', content: 'late', createdAt: iso(99), updatedAt: iso(99), deletedAt: null });
            server.chatMessages.set('r000-early', { id: 'r000-early', userId: USER, conversationId: 'c', role: 'user', content: 'early', createdAt: iso(0), updatedAt: iso(0), deletedAt: null });
            expect(page.rows.length).toBe(3);
        };
        const seen = [];
        const orig = api.fetchPage.getMockImplementation();
        api.fetchPage.mockImplementation(async (...a) => { const p = await orig(...a); seen.push(...p.rows.map((r) => r.id)); return p; });
        await pullTable(USER, 'chatMessages');
        expect(new Set(seen).size).toBe(seen.length); // no duplicates
        expect(await db.chatMessages.count()).toBe(10); // 9 seeded + zz-late; r000-early sorts behind the cursor
        expect(await db.chatMessages.get('zz-late')).toBeTruthy();
        // the "early" row sorts before the saved cursor: it is picked up by the next sync only if its updatedAt moves on
        // (server updated_at is monotonic in practice), the pull itself never re-reads rows behind the cursor
        expect(seen.filter((id) => id === 'r000').length).toBe(1);
    });

    it('saves the cursor after each page so an interrupted pull resumes where it stopped', async () => {
        seed(10);
        let calls = 0;
        onPage = async () => {
            calls++;
            if (calls === 3) throw new Error('Failed to fetch');
        };
        await expect(pullTable(USER, 'chatMessages')).rejects.toThrow('Failed to fetch');
        expect(await db.chatMessages.count()).toBe(6);
        const cursor = await getMeta(`pcursor:${USER}:chatMessages`);
        expect(cursor.id).toBe('r005');
        onPage = null;
        api.fetchPage.mockClear();
        const out = await pullTable(USER, 'chatMessages');
        expect(out.downloaded).toBe(4);
        expect(api.fetchPage.mock.calls[0][2]).toEqual(cursor);
        expect(await db.chatMessages.count()).toBe(10);
        // a later pull with nothing new asks once and stops
        api.fetchPage.mockClear();
        await pullTable(USER, 'chatMessages');
        expect(api.fetchPage).toHaveBeenCalledTimes(1);
    });
});

describe('fetchPage query (api.js)', () => {
    it('builds a keyset filter on (updated_at, id), ordered the same way, with a limit', async () => {
        vi.resetModules();
        const calls = [];
        const builder = new Proxy({}, {
            get: (_t, name) => (name === 'then' ? undefined : (...args) => { calls.push([name, ...args]); return name === 'limit' ? Promise.resolve({ data: [], error: null }) : builder; }),
        });
        vi.doMock('../../services/supabaseService', () => ({ supabase: { from: () => builder } }));
        vi.doUnmock('../api');
        const real = await vi.importActual('../api');
        await real.fetchPage('chatMessages', USER, { updatedAt: '2026-11-11T10:00:00.123456+00:00', id: 'abc' }, 50);
        const or = calls.find((c) => c[0] === 'or')[1];
        expect(or).toBe('updated_at.gt."2026-11-11T10:00:00.123456+00:00",and(updated_at.eq."2026-11-11T10:00:00.123456+00:00",id.gt.abc)');
        expect(calls.filter((c) => c[0] === 'order').map((c) => [c[1], c[2].ascending])).toEqual([['updated_at', true], ['id', true]]);
        expect(calls.find((c) => c[0] === 'limit')[1]).toBe(50);
        expect(calls.some((c) => c[0] === 'range')).toBe(false); // keyset, not offset
        vi.doUnmock('../../services/supabaseService');
    });
});
