// Turns a savings opportunity (savingsOpportunities.js) into translated text and a route (pass 3, A3). Pure.
// The same wording is the fallback when the AI explanation is missing, offline, out of date or was rejected by the number check.
import { collectNumbers, figuresNotIn } from '../utils/numberGuard';

const MONEY = ['excess', 'current', 'baseline', 'total', 'average', 'amount', 'yearly', 'from', 'to', 'increase', 'yearlyIncrease', 'difference', 'cheaperAverage', 'pricierAverage', 'median', 'suggestedBudget', 'lowest', 'highest', 'averageOver', 'saving', 'remaining', 'pace', 'monthly', 'budget'];

/**
 * opportunityText(o, { t, money, localizeCategory, date }) -> { title, body, why, action, badge, examples[] }
 *   money(n) formats an amount, date('YYYY-MM-DD') a day; both come from the screen so the text follows the app language.
 */
export function opportunityText(o, { t, money, localizeCategory = (x) => x, date = (d) => d }) {
    const raw = o.params || {};
    const p = { ...raw };
    for (const k of MONEY) if (typeof p[k] === 'number') p[k] = money(p[k]);
    if (p.category) p.category = localizeCategory(p.category);
    if (p.since) p.since = date(p.since);
    if (p.endsOn) p.endsOn = date(p.endsOn);
    if (Array.isArray(p.names)) p.names = p.names.join(', ');
    p.saving = p.saving ?? money(o.monthlySaving);
    const k = `opp.${o.kind}`;
    let title = `${k}.title`;
    let body = `${k}.body`;
    let why = `${k}.why`;
    if (o.kind === 'category_above_baseline' && raw.running) body = `${k}.bodyRunning`;
    if (o.kind === 'subscription_review' && raw.unchangedMonths > 0) {
        body = `${k}.bodyUnchanged`;
        p.months = raw.unchangedMonths;
    }
    if (o.kind === 'cheaper_store') {
        const s = raw.basis === 'items' ? 'Items' : 'Basket';
        title = `${k}.title${s}`;
        body = `${k}.body${s}`;
        why = `${k}.why${s}`;
    }
    if (o.kind === 'goal_boost' && (raw.sooner === null || raw.sooner === undefined)) {
        title = `${k}.titleStart`;
        body = `${k}.bodyStart`;
    }
    if (o.kind === 'debt_cost' && raw.incomePct !== null && raw.incomePct !== undefined) body = `${k}.bodyPct`;
    let bodyText = t(body, p);
    if (o.kind === 'debt_cost' && raw.endsOn) bodyText = `${bodyText} ${t(`${k}.ends`, p)}`;
    const a = o.action || {};
    const action =
        a.type === 'set_budget' ? t('opp.action.set_budget', { amount: money(a.amount) })
        : a.type === 'add_goal' ? t('opp.action.add_goal', { amount: money(a.amount) })
        : a.type === 'categorise' ? t('opp.action.categorise', { count: raw.count })
        : a.type ? t(`opp.action.${a.type}`) : '';
    const examples = (raw.examples || []).map((e) => t('opp.cheaper_store.example', { name: e.name, base: e.base, cheaperPrice: money(e.cheaperPrice), pricierPrice: money(e.pricierPrice) }));
    const badgeKey = `opp.badge.${o.kind}`;
    const badge = t(badgeKey) === badgeKey ? t('opp.badge.none') : t(badgeKey);
    return { title: t(title, p), body: bodyText, why: t(why, p), action, badge, examples };
}

/**
 * Where the card's button leads. The list always opens on the exact dates the numbers were computed over (`scope`), so what the
 * owner sees matches the card. mark_recurring and add_goal are done in place (a preview sheet / the prefilled transfer): null.
 */
export function opportunityHref(o, { periodSpec } = {}) {
    const a = o?.action;
    if (!a) return null;
    const q = new URLSearchParams();
    const range = o.scope?.start && o.scope?.end ? `r:${o.scope.start}..${o.scope.end}` : 'all';
    if (a.type === 'set_budget') {
        if (periodSpec) q.set('m', periodSpec);
        q.set('budget', a.category);
        q.set('amount', String(a.amount));
        return `/plan?${q.toString()}`;
    }
    if (a.type === 'open_filter' || a.type === 'review_subscription') {
        q.set('m', range);
        if (a.category) q.set('cat', a.category);
        if (a.merchant) q.set('merchant', a.merchant);
        if (a.groupId) q.set('group', a.groupId);
        return `/activity?${q.toString()}`;
    }
    if (a.type === 'categorise') {
        q.set('m', range);
        q.set('uncat', '1');
        return `/activity?${q.toString()}`;
    }
    return null;
}

/**
 * The AI's sentence for a card, only while it still agrees with the card: every figure in it must be one of the card's current
 * figures (the numbers move as days pass; a sentence that quotes yesterday's amount is not shown). -> { explanation, howTo } | null
 */
export function trustedExplanation(o, entry) {
    if (!o || !entry || typeof entry.explanation !== 'string' || !entry.explanation.trim()) return null;
    const known = collectNumbers([o.params, o.monthlySaving, o.yearlySaving, o.scope, o.action]);
    if (figuresNotIn(entry.explanation, known, { minInteger: 10 }).length) return null;
    const howTo = typeof entry.howTo === 'string' && entry.howTo.trim() && figuresNotIn(entry.howTo, known, { minInteger: 10 }).length === 0 ? entry.howTo : null;
    return { explanation: entry.explanation, howTo };
}

/** Suggested questions for the chat, made from the cards shown (most useful first, at most 3). */
export function opportunityQuestions(list = [], { t, money, localizeCategory = (x) => x }) {
    const out = [];
    if (list.some((o) => o.monthlySaving > 0)) out.push(t('insights.ask.save'));
    for (const o of list) {
        if (o.kind === 'category_above_baseline') out.push(t('insights.ask.category', { category: localizeCategory(o.category) }));
        else if (o.kind === 'merchant_frequency' || o.kind === 'subscription_review' || o.kind === 'price_creep') out.push(t('insights.ask.merchant', { name: o.merchantName }));
        else if (o.kind === 'goal_boost' && o.params.saving) out.push(t('insights.ask.afford', { amount: money(o.params.saving) }));
    }
    return [...new Set(out)].slice(0, 3);
}
