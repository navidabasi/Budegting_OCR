// Turns an insightsEngine finding into translated text and a route (plan P6-T3). Pure.
const MONEY_PARAMS = ['amount', 'current', 'average', 'spent', 'budget', 'over', 'projected', 'perDay', 'typical', 'yearly', 'saved', 'income', 'total', 'fixed', 'flexible', 'left', 'upcoming', 'weekend', 'weekday', 'lastWeek', 'earlier'];

/**
 * findingText(finding, { t, money, localizeCategory }) -> { title, body }
 * Uses `i18nKey.title` / `i18nKey.body`; money params are formatted, category names localised, and the
 * whole-month budget label becomes "Whole month". Falls back to the engine's English text when a key is missing.
 */
export function findingText(f, { t, money, localizeCategory }) {
    if (!f?.i18nKey) return { title: f?.title || '', body: f?.body || '' };
    const p = { ...(f.params || {}) };
    for (const k of MONEY_PARAMS) if (typeof p[k] === 'number') p[k] = money(p[k]);
    if (p.category) p.category = localizeCategory(p.category);
    if ('label' in p) p.label = f.params.category ? localizeCategory(f.params.category) : t('budgets.wholeMonth');
    const title = t(`${f.i18nKey}.title`, p);
    const body = t(`${f.i18nKey}.body`, p);
    return {
        title: title === `${f.i18nKey}.title` ? f.title : title,
        body: body === `${f.i18nKey}.body` ? f.body : body,
    };
}

/** Where a finding leads: filtered Activity, Budgets, Savings or the transaction. */
export function findingHref(f) {
    const link = f?.link;
    if (!link) return '/insights';
    const p = new URLSearchParams();
    const params = link.params || {};
    if (link.screen === 'transaction') return params.id ? `/receipts/${params.id}` : '/activity';
    if (link.screen === 'activity') {
        if (params.m) p.set('m', params.m);
        if (params.type) p.set('type', params.type);
        if (params.category === 'uncategorised') p.set('uncat', '1');
        else if (params.category) p.set('cat', params.category);
        if (params.merchant) p.set('merchant', params.merchant);
        return `/activity?${p.toString()}`;
    }
    if (link.screen === 'breakdown') return params.m ? `/breakdown?m=${encodeURIComponent(params.m)}` : '/breakdown';
    if (link.screen === 'budgets' || link.screen === 'savings') {
        if (params.m) p.set('m', params.m);
        if (link.screen === 'savings') p.set('tab', 'savings');
        const q = p.toString();
        return q ? `/plan?${q}` : '/plan';
    }
    return '/insights';
}
