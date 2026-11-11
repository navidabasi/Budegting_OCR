import { describe, it, expect } from 'vitest';
import { compactEvidence, packMeta, unpackMessage, META_MAX_BYTES } from '../chatMeta';

const bigPack = (nFacts = 400) => ({
    version: 1, intent: 'grocery_breakdown', question: 'q', currency: 'EUR', basis: 'share',
    period: { start: '2026-11-01', end: '2026-11-30', state: 'current', day: 10, days: 30 },
    coverage: { total: 100, itemised: 60, unknown: 40, share: 60, receipts: 5, receiptsWithItems: 3 },
    facts: Array.from({ length: nFacts }, (_, i) => ({ id: `F${i + 1}`, kind: 'merchant', name: `M${i}`, amount: i, refs: [`R${i + 1}`] })),
    evidence: Array.from({ length: nFacts }, (_, i) => ({ id: `R${i + 1}`, merchant: 'x'.repeat(200), name: 'y'.repeat(200), amount: i })),
});
const refsOf = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`R${i + 1}`, { txId: `t${i}`, itemId: null }]));
const size = (v) => JSON.stringify(v).length;

describe('chat meta', () => {
    it('keeps a normal answer unchanged', () => {
        const ev = { pack: bigPack(3), refs: refsOf(3), citations: ['F1'], uncertain: [], grounded: true, unsupported: [], proposals: [], state: 'ok' };
        expect(compactEvidence(ev)).toBe(ev);
    });
    it('stays under the limit, dropping uncited facts and their receipts but never citations, period, refs of cited facts or coverage', () => {
        const ev = { pack: bigPack(), refs: refsOf(400), citations: ['F2', 'F7'], uncertain: [], grounded: true, unsupported: [], proposals: [], state: 'ok' };
        expect(size(ev)).toBeGreaterThan(META_MAX_BYTES);
        const out = compactEvidence(ev);
        expect(size(out)).toBeLessThanOrEqual(META_MAX_BYTES);
        expect(out.citations).toEqual(['F2', 'F7']);
        expect(out.pack.period).toEqual(ev.pack.period);
        expect(out.pack.coverage).toEqual(ev.pack.coverage);
        expect(out.pack.facts.map((f) => f.id)).toEqual(['F2', 'F7']);
        expect(Object.keys(out.refs).sort()).toEqual(['R2', 'R7']);
        expect(out.pack.evidence.map((e) => e.id).sort()).toEqual(['R2', 'R7']);
    });
    it('trims a failed answer (all facts shown) without losing period or coverage', () => {
        const ev = { pack: bigPack(), refs: refsOf(400), citations: [], uncertain: [], grounded: true, unsupported: [], proposals: [], state: 'failed' };
        const out = compactEvidence(ev);
        expect(size(out)).toBeLessThanOrEqual(META_MAX_BYTES);
        expect(out.pack.coverage).toEqual(ev.pack.coverage);
        expect(out.pack.period).toEqual(ev.pack.period);
        expect(out.pack.facts.length).toBeGreaterThan(0);
    });
    it('round-trips action, evidence and error info through packMeta / unpackMessage', () => {
        const m = { role: 'assistant', content: 'a', action: { type: 'open_filter', payload: {} }, error: true, retry: 'q', intent: 'change', ev: { pack: bigPack(2), refs: refsOf(2), citations: [], state: 'failed' } };
        const back = unpackMessage({ id: 'x', role: 'assistant', content: 'a', meta: packMeta(m) });
        expect(back).toMatchObject({ id: 'x', role: 'assistant', content: 'a', action: m.action, error: true, retry: 'q', intent: 'change' });
        expect(back.ev.pack.period).toEqual(m.ev.pack.period);
        expect(packMeta({ role: 'user', content: 'q' })).toBeNull();
        expect(unpackMessage({ id: 'u', role: 'user', content: 'q', meta: null })).toEqual({ id: 'u', role: 'user', content: 'q' });
    });
});
