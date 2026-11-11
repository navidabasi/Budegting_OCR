import { subcategoryLabel } from '../receipts/subcategoryLabel';

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
        default:
            return f.kind;
    }
}
