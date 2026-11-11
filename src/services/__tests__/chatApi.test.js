import { describe, it, expect, vi } from 'vitest';
import { actionHref, loadThread, saveThread, sendChat, toApiMessages, trimThread, MAX_TURNS } from '../chatApi';

const u = (c) => ({ role: 'user', content: c });
const a = (c, extra = {}) => ({ role: 'assistant', content: c, ...extra });
const mem = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};

describe('thread trimming', () => {
    it('keeps the last 10 messages and starts with a user message', () => {
        const thread = Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? u(`q${i}`) : a(`a${i}`)));
        const t = trimThread(thread);
        expect(t.length).toBeLessThanOrEqual(MAX_TURNS);
        expect(t[0].role).toBe('user');
        expect(t[t.length - 1].content).toBe('a13');
    });
    it('drops a leading assistant message after trimming', () => {
        const thread = [u('1'), a('2'), u('3'), a('4'), u('5'), a('6'), u('7'), a('8'), u('9'), a('10'), u('11')];
        const t = trimThread(thread);
        expect(t.map((m) => m.content)).toEqual(['3', '4', '5', '6', '7', '8', '9', '10', '11']);
    });
    it('toApiMessages strips client-only fields and error bubbles', () => {
        expect(toApiMessages([u('hi'), a('boom', { error: true }), a('ok', { action: { type: 'set_budget' } })])).toEqual([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'ok' }]);
    });
    it('round-trips through sessionStorage and survives bad data', () => {
        const s = mem();
        saveThread([u('a'), a('b', { action: { type: 'add_goal', payload: {} } })], s);
        expect(loadThread(s)).toEqual([u('a'), a('b', { action: { type: 'add_goal', payload: {} } })]);
        s.setItem('wmw-chat-thread', '{oops');
        expect(loadThread(s)).toEqual([]);
        expect(loadThread(null)).toEqual([]);
    });
});

describe('sendChat', () => {
    it('posts { aggregates, messages, language } with the bearer token', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ answer: 'Cut dining.', suggestedAction: { type: 'set_budget', payload: { category: 'Dining', amount: 150 } }, model: 'm' }) });
        const out = await sendChat({ aggregates: { month: '2026-11' }, thread: [u('Where can I cut 100 €?')], language: 'it', getToken: async () => 'tok', fetchImpl });
        expect(out.suggestedAction.type).toBe('set_budget');
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('/api/chat');
        expect(init.headers.Authorization).toBe('Bearer tok');
        expect(JSON.parse(init.body)).toEqual({ aggregates: { month: '2026-11' }, messages: [u('Where can I cut 100 €?')], language: 'it' });
    });
    it('rate limit', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
        await expect(sendChat({ aggregates: {}, thread: [u('x')], getToken: async () => 't', fetchImpl })).rejects.toMatchObject({ kind: 'rateLimit' });
    });
});

describe('actionHref', () => {
    it('opens prefilled screens and never writes', () => {
        expect(actionHref({ type: 'set_budget', payload: { category: 'Dining', amount: 180 } }, '2026-11')).toBe('/plan?m=2026-11&budget=Dining&amount=180');
        expect(actionHref({ type: 'set_budget', payload: { category: 'Total', amount: 2000 } }, '2026-11')).toBe('/plan?m=2026-11&budget=*&amount=2000');
        expect(actionHref({ type: 'add_goal', payload: { name: 'Japan', targetAmount: 3000, targetDate: '2027-07-01' } })).toBe('/plan?tab=savings&goal=Japan&target=3000&date=2027-07-01');
        expect(actionHref({ type: 'open_filter', payload: { category: 'Dining', month: '2026-10' } })).toBe('/activity?m=2026-10&cat=Dining');
        expect(actionHref({ type: 'open_filter', payload: { screen: 'savings' } }, '2026-11')).toBe('/plan?m=2026-11&tab=savings');
        // A multi-month answer ("average grocery spend") links to every matching transaction, not the current period
        expect(actionHref({ type: 'open_filter', payload: { screen: 'activity', category: 'Groceries', month: 'all' } }, '2026-11')).toBe('/activity?m=all&cat=Groceries');
        expect(actionHref({ type: 'open_filter', payload: { category: 'Groceries' } }, '2026-11')).toBe('/activity?m=all&cat=Groceries');
        expect(actionHref({ type: 'nope', payload: {} })).toBeNull();
    });
});
