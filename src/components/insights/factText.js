import { subcategoryLabel } from '../receipts/subcategoryLabel';
import { opportunityText } from '../../services/opportunityText';
import { patternText } from '../../services/patternText';

const signed = (money, v) => `${v > 0 ? '+' : ''}${money(v)}`;

/**
 * One fact of an evidence pack as a sentence in the app language. Amounts are in the pack's currency; the numbers are the ones the
 * calculation layer produced (nothing is recomputed here).
 * ctx: { t, money(v), localizeCategory(name) }
 */
export function factText(f, { t, money, localizeCategory = (x) => x }) {
    const cat = (c) => localizeCategory(c);
    switch (f.kind) {
        case 'period_summary':
            return t('evidence.fact.period_summary', { spent: money(f.spent), income: money(f.income), saved: money(f.saved), upcoming: money(f.upcoming) });
        case 'merchant':
            return f.sharePct === null || f.sharePct === undefined ? t('evidence.fact.merchantNoPct', { name: f.name, amount: money(f.amount), count: f.count }) : t('evidence.fact.merchant', { name: f.name, amount: money(f.amount), count: f.count, pct: f.sharePct });
        case 'spend_total':
            return t('evidence.fact.spend_total', { amount: money(f.amount) });
        case 'category_total':
            if (f.sharePct !== undefined && f.sharePct !== null) return t('evidence.fact.category_share', { category: cat(f.category), amount: money(f.amount), pct: f.sharePct });
            if (f.count === undefined) return t('evidence.fact.category_simple', { category: cat(f.category), amount: money(f.amount) });
            return [t('evidence.fact.category_total', { category: cat(f.category), amount: money(f.amount), count: f.count }), f.otherCategoryLines > 0 ? t('evidence.fact.category_other', { amount: money(f.otherCategoryLines) }) : ''].filter(Boolean).join(' ');
        case 'subcategory':
            return f.label === 'unknown' ? t('evidence.fact.subcategoryUnknown', { amount: money(f.amount) }) : t('evidence.fact.subcategory', { label: subcategoryLabel(t, f.label), amount: money(f.amount) });
        case 'top_items':
            return t('evidence.fact.top_items', { list: (f.items || []).map((i) => `${i.name} ${money(i.amount)}`).join(', ') });
        case 'change_total': {
            const label = f.label === 'all' ? t('evidence.basis.all') : cat(f.label);
            return t('evidence.fact.change_total', { label, current: money(f.current), previous: money(f.previous), delta: signed(money, f.delta) });
        }
        case 'change_row':
            return t('evidence.fact.change_row', { label: f.by === 'subcategory' ? subcategoryLabel(t, f.label) || f.label : f.by === 'category' ? cat(f.label) : f.label, current: money(f.current), previous: money(f.previous), delta: signed(money, f.delta) });
        case 'unit_price':
            return t('evidence.fact.unit_price', { name: f.name, base: f.base, qtyNow: f.qtyNow, qtyPrev: f.qtyPrev, priceNow: money(f.priceNow), pricePrev: money(f.pricePrev), verdict: t(`evidence.verdict.${f.verdict}`) });
        case 'unit_note':
            return t('evidence.fact.unit_note', { count: f.skippedMixedUnits });
        case 'owed_total':
            return t('evidence.fact.owed_total', { owedToMe: money(f.owedToMe), iOwe: money(f.iOwe) });
        case 'balance':
            return t(`evidence.fact.balance.${f.direction}`, { name: f.name, amount: money(f.amount), open: f.openItems });
        case 'review_count':
            return t(`evidence.fact.review_count.${f.label}`, { count: f.count, amount: money(f.amount || 0) });
        case 'subscription_like':
            return t('evidence.fact.subscription_like', { name: f.name, amount: money(f.amount), months: f.months });
        case 'budget':
            return t('evidence.fact.budget', { category: f.category === 'Total' ? t('budgets.wholeMonth') : cat(f.category), spent: money(f.spent), budget: money(f.budget), status: t(`evidence.status.${f.status}`), projected: money(f.projected) });
        case 'commitments':
            return t('evidence.fact.commitments', { upcoming: money(f.upcoming), saved: money(f.saved), income: money(f.income) });
        case 'goal':
            return t('evidence.fact.goal', { name: f.name, saved: money(f.saved), target: money(f.target), remaining: money(f.remaining) });
        case 'opportunity': {
            const text = opportunityText({ kind: f.oppKind, params: f, monthlySaving: f.monthlySaving, action: { type: f.action } }, { t, money, localizeCategory });
            return t('evidence.fact.opportunity', { title: text.title, body: text.body });
        }
        case 'saving_total':
            return t('evidence.fact.saving_total', { monthly: money(f.monthly), yearly: money(f.yearly) });
        case 'afford_room':
            return t('evidence.fact.afford_room', { income: money(f.income), spent: money(f.spent), upcoming: money(f.upcoming), left: money(f.left), daysLeft: f.daysLeft, perDay: money(f.perDay) });
        case 'afford_budget':
            return t('evidence.fact.afford_budget', { budget: money(f.budget), budgetLeft: money(f.budgetLeft) });
        case 'afford_request':
            return t(`evidence.fact.afford_request.${f.verdict}`, { amount: money(f.amount), leftAfter: money(f.leftAfter), perDayAfter: money(f.perDayAfter), short: money(f.short) });
        case 'history_scope':
            return t('evidence.fact.history_scope', { category: f.category === 'all spending' ? t('evidence.fact.allSpending') : cat(f.category), from: f.from, to: f.to, completeMonths: f.completeMonths });
        case 'history_average':
            return t('evidence.fact.history_average', { average: money(f.averagePerMonth ?? 0), median: money(f.medianPerMonth ?? 0), running: money(f.runningMonthSoFar) });
        case 'history_cycle_average':
            return [t('evidence.fact.history_scope_cycle', { category: f.category === 'all spending' ? t('evidence.fact.allSpending') : cat(f.category), from: f.from, to: f.to, completeCycles: f.completeCycles }), t('evidence.fact.history_cycle_average', { average: money(f.averagePerCycle ?? 0), median: money(f.medianPerCycle ?? 0), running: money(f.runningCycleSoFar) })].join(' ');
        case 'history_month':
            return t('evidence.fact.history_month', { month: f.month, amount: money(f.amount), count: f.count });
        case 'history_cycle':
            return t('evidence.fact.history_month', { month: `${f.start} – ${f.end}`, amount: money(f.amount), count: f.count });
        case 'history_category':
            return t('evidence.fact.history_category', { category: cat(f.category), average: money(f.averagePerMonth) });
        case 'budget_absent':
            return f.suggestion ? t('evidence.fact.budget_absent', { category: cat(f.category), months: f.basedOnMonths, amount: money(f.suggestion) }) : t('evidence.fact.budget_absentNone', { category: cat(f.category) });
        case 'glossary':
            return t('evidence.fact.glossary', { category: cat(f.category) });
        case 'app_feature':
            return t('evidence.fact.app_feature', { screen: t(`appMap.screen.${f.screen}`) });
        case 'pattern': {
            const { patternKind, severity, periodStart, periodEnd, ...params } = f;
            const text = patternText({ kind: patternKind, params, severity, scope: { start: periodStart, end: periodEnd } }, { t, money, localizeCategory });
            return `${text.title}. ${text.body}`;
        }
        case 'app_screens':
            return t('evidence.fact.app_screens');
        default:
            return f.kind;
    }
}
