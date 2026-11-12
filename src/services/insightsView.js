// View models for the Insights page (pass 3, A3). Pure.
import { addDays, dateKey } from '../utils/monthMath';
import { inPeriod, periodProgress, previousPeriods, toRange } from '../utils/period';
import { round2, spentByCategory } from '../utils/money';
import { trustedExplanation } from './opportunityText';

/**
 * "Where your money went": the biggest categories of the period with the change against the previous one. While the period runs
 * both sides cover the same elapsed days. -> { rows: [{ category, amount, previous, delta, pct }], total, comparable, running }
 * `previous` is null when there is no earlier period on record (the row then has no arrow).
 */
export function topCategories({ transactions = [], trips = [], period, today = new Date(), limit = 5 } = {}) {
    const range = toRange(period);
    const progress = periodProgress(period, today);
    if (!range) return { rows: [], total: 0, comparable: false, running: false };
    const running = progress.state === 'current';
    const cut = (r) => (running ? { start: r.start, end: addDays(r.start, progress.day - 1) < r.end ? addDays(r.start, progress.day - 1) : r.end } : r);
    const txs = (transactions || []).filter((t) => t && !t.isDemo);
    const now = spentByCategory(txs, cut(range), { trips, includeTrips: true });
    const prev = toRange(previousPeriods(period, 1)[0]);
    const first = txs.map((t) => dateKey(t.date)).filter(Boolean).sort()[0];
    const comparable = !!(prev && first && first <= prev.end && txs.some((t) => inPeriod(t.date, prev)));
    const before = comparable ? spentByCategory(txs, cut(prev), { trips, includeTrips: true }) : {};
    const total = round2(Object.values(now).reduce((s, v) => s + v, 0));
    const rows = Object.entries(now)
        .filter(([, amount]) => amount > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([category, amount]) => {
            const previous = comparable ? before[category] || 0 : null;
            return { category, amount, previous, delta: previous === null ? null : round2(amount - previous), pct: total > 0 ? Math.round((amount / total) * 100) : 0 };
        });
    return { rows, total, comparable, running };
}

/**
 * The AI's sentences matched to the cards on screen. `refs` is the map saved with the summary (O1 -> opportunity key); a sentence
 * is used only for a card that still exists and while its figures are still the card's figures. -> Map(key -> { explanation, howTo })
 */
export function explanationsFor(opportunities = [], narrative, refs = {}) {
    const out = new Map();
    const byKey = new Map(opportunities.map((o) => [o.key, o]));
    for (const entry of narrative?.opportunities || []) {
        const o = byKey.get(refs?.[entry.id]);
        const ok = trustedExplanation(o, entry);
        if (o && ok) out.set(o.key, ok);
    }
    return out;
}

/**
 * Wins and watch-outs for the two lists. From the AI summary when it is current (each note linked to the finding or card it names);
 * otherwise from the app's own findings: positive ones are wins, high and medium ones are watch-outs.
 * -> { wins: [{ text, detail, findingId, opportunityKey }], watchouts: [...] }
 */
export function winsAndWatchouts({ findings = [], narrative, refs = {}, stale = false, findingText, limit = 3 } = {}) {
    const fromFinding = (f) => ({ ...findingText(f), findingId: f.id, opportunityKey: null });
    const own = {
        wins: findings.filter((f) => f.severity === 'positive').slice(0, limit).map(fromFinding).map((x) => ({ text: x.title, detail: x.body, findingId: x.findingId, opportunityKey: null })),
        watchouts: findings.filter((f) => f.severity === 'high' || f.severity === 'medium').slice(0, limit).map(fromFinding).map((x) => ({ text: x.title, detail: x.body, findingId: x.findingId, opportunityKey: null })),
    };
    const ai = (list) =>
        (list || []).slice(0, limit).map((n) => {
            const target = n.ref ? refs?.[n.ref] : null;
            return { text: n.text, detail: null, findingId: n.ref?.startsWith('N') && findings.some((f) => f.id === target) ? target : null, opportunityKey: n.ref?.startsWith('O') ? target || null : null };
        });
    if (stale || !narrative || narrative.v !== 2) return own;
    const wins = ai(narrative.wins);
    const watchouts = ai(narrative.watchouts);
    return { wins: wins.length ? wins : own.wins, watchouts: watchouts.length ? watchouts : own.watchouts };
}
