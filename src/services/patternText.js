// Text and links for a spending pattern (assistant v2, B-T3). Pure: the figures are the ones patternInsights.js computed.
// ctx: { t, money(v), short(v)?, localizeCategory(name), number(v) }

/** -> { title, body } in the app language. */
export function patternText(p, { t, money, short = money, localizeCategory = (x) => x, number = (v) => String(v) }) {
    const q = p?.params || {};
    switch (p?.kind) {
        case 'weekend_heavy':
            return { title: t('pattern.weekend_heavy.title', { weekend: money(q.weekendPerDay), weekday: money(q.weekdayPerDay) }), body: t('pattern.weekend_heavy.body', { days: q.days, pct: q.weekendPct }) };
        case 'small_purchases':
            return { title: t('pattern.small_purchases.title', { count: q.count, under: short(q.under), total: money(q.total) }), body: t('pattern.small_purchases.body', { baseline: money(q.baselineTotal), extra: money(q.extra) }) };
        case 'first_week_spike':
            return { title: t('pattern.first_week_spike.title', { pct: q.firstWeekPct, days: q.days }), body: t('pattern.first_week_spike.body', { periods: q.periods, first: money(q.perDayFirstWeek), rest: money(q.perDayRest) }) };
        case 'merchant_cadence':
            return { title: t('pattern.merchant_cadence.title', { merchant: q.merchant, every: number(q.everyDays) }), body: t('pattern.merchant_cadence.body', { visits: q.visits, days: q.days, perVisit: money(q.perVisit), perMonth: money(q.perMonth) }) };
        case 'category_streak':
            return { title: t(`pattern.category_streak.${q.direction === 'down' ? 'down' : 'up'}`, { category: localizeCategory(q.category), periods: q.periods }), body: t('pattern.category_streak.body', { first: money(q.first), last: money(q.last) }) };
        case 'payday_effect':
            return { title: t('pattern.payday_effect.title', { days: q.days, after: money(q.perDayAfter) }), body: t('pattern.payday_effect.body', { other: money(q.perDayOther), paydays: q.paydays }) };
        default:
            return { title: p?.kind || '', body: '' };
    }
}

/** Activity filtered to the transactions behind a pattern (its dates, and its category, merchant or amount cap). */
export function patternHref(p) {
    if (!p?.scope?.start || !p?.scope?.end) return null;
    const q = new URLSearchParams();
    q.set('m', `r:${p.scope.start}..${p.scope.end}`);
    if (p.filter?.category) q.set('cat', p.filter.category);
    if (p.filter?.merchant) q.set('merchant', p.filter.merchant);
    if (p.filter?.max) q.set('max', String(p.filter.max));
    return `/activity?${q.toString()}`;
}
