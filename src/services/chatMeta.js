// What a stored assistant message keeps in `meta` (chat_messages.meta jsonb) so a reopened answer renders exactly as before:
// the evidence (period, basis, coverage, cited facts and the receipts/lines behind them, refs), the suggested action, the
// proposals and the state (ok / failed / offline / insufficient), plus the retry info of an error answer.
// Bulky fields that can be recomputed are dropped when a message would exceed META_MAX_BYTES; citations, period, refs and
// coverage are never dropped.

export const META_MAX_BYTES = 100 * 1024;

const size = (v) => {
    try {
        const s = JSON.stringify(v);
        return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length;
    } catch {
        return Infinity;
    }
};

/** Keep only evidence rows (and their refs) that a remaining fact points at. */
function pruneEvidence(pack, refs, facts) {
    const used = new Set(facts.flatMap((f) => f.refs || []));
    return {
        pack: { ...pack, facts, evidence: (pack.evidence || []).filter((e) => used.has(e.id)) },
        refs: Object.fromEntries(Object.entries(refs || {}).filter(([id]) => used.has(id))),
    };
}

/** { pack, refs, citations, ... } -> the same, within `max` bytes. Never touches citations, period, refs of kept facts or coverage. */
export function compactEvidence(ev, max = META_MAX_BYTES) {
    if (!ev?.pack || size(ev) <= max) return ev;
    let out = ev;
    const cited = new Set(ev.citations || []);
    // 1. a successful answer only shows the facts it cites: the others (and their receipts) can be recomputed
    if (ev.state === 'ok' && cited.size) {
        const facts = (ev.pack.facts || []).filter((f) => cited.has(f.id));
        out = { ...out, ...pruneEvidence(ev.pack, ev.refs, facts) };
        if (size(out) <= max) return out;
    }
    // 2. proposals were previewed against the records of that moment: keep the first few, with a bounded record list
    if (out.proposals?.length) {
        const slim = out.proposals.slice(0, 5).map((p) => (Array.isArray(p.records) ? { ...p, records: p.records.slice(0, 20) } : p));
        out = { ...out, proposals: slim };
        if (size(out) <= max) return out;
    }
    // 3. fewer receipt rows per fact, then fewer facts (cited ones first)
    let facts = [...(out.pack.facts || [])].sort((a, b) => Number(cited.has(b.id)) - Number(cited.has(a.id)));
    for (const keep of [30, 15, 8]) {
        facts = facts.slice(0, keep).map((f) => ({ ...f, refs: (f.refs || []).slice(0, 2) }));
        const mapped = new Map(facts.map((f) => [f.id, f]));
        out = { ...out, ...pruneEvidence(out.pack, ev.refs, (out.pack.facts || []).filter((f) => mapped.has(f.id)).map((f) => mapped.get(f.id))) };
        if (size(out) <= max) return out;
    }
    return out;
}

/** A display message ({ role, content, action?, ev?, error?, retry?, intent? }) -> the meta object stored with it, or null. */
export function packMeta(m) {
    if (!m || m.role !== 'assistant') return null;
    const meta = {};
    if (m.ev) meta.ev = compactEvidence(m.ev);
    if (m.action) meta.action = m.action;
    if (m.error) {
        meta.error = true;
        if (m.retry) meta.retry = m.retry;
        if (m.intent) meta.intent = m.intent;
    }
    return Object.keys(meta).length ? meta : null;
}

/** A stored row -> the display message the chat renders. */
export function unpackMessage(row) {
    const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
    return {
        id: row.id,
        role: row.role,
        content: row.content,
        ...(meta.action ? { action: meta.action } : {}),
        ...(meta.ev ? { ev: meta.ev } : {}),
        ...(meta.error ? { error: true, retry: meta.retry, intent: meta.intent } : {}),
    };
}
