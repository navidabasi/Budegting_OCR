import { describe, it, expect } from 'vitest';
import { opportunityHref, opportunityText, trustedExplanation } from '../opportunityText';
import { computeOpportunities, OPPORTUNITY_KINDS } from '../savingsOpportunities';
import { ownerLike, TODAY } from '../__fixtures__/ownerLike';
import { currentCyclePeriod, normalizeConfig } from '../../utils/payCycle';
import { en } from '../../languages/en';
import { it as itPack } from '../../languages/it';
import { de } from '../../languages/de';
import { es } from '../../languages/es';
import { fr } from '../../languages/fr';
import { fa } from '../../languages/fa';
import { ar } from '../../languages/ar';
const TRANSLATIONS = { en, it: itPack, de, es, fr, fa, ar };
import { parseFilters } from '../../utils/activityFilters';

const lookup = (lang) => (key, params = {}) => {
    let v = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), TRANSLATIONS[lang]);
    if (typeof v !== 'string') return key;
    return v.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in params ? String(params[k]) : m));
};
const ctx = (lang = 'en') => ({ t: lookup(lang), money: (n) => `€${Math.round(n * 100) / 100}`, localizeCategory: (c) => c, date: (d) => d });
const d = ownerLike();
const period = currentCyclePeriod(normalizeConfig(d.config), new Date(`${TODAY}T12:00:00Z`));
const { all, top } = computeOpportunities({ ...d, period });
const of = (kind) => all.find((o) => o.kind === kind);

describe('opportunityText', () => {
    it('every kind has complete wording in all 7 languages: no missing key, no unfilled placeholder', () => {
        expect(new Set(all.map((o) => o.kind)).size).toBe(OPPORTUNITY_KINDS.length);
        for (const lang of ['en', 'it', 'de', 'es', 'fr', 'fa', 'ar']) {
            for (const o of all) {
                const text = opportunityText(o, ctx(lang));
                for (const [k, v] of Object.entries(text)) {
                    if (k === 'examples') continue;
                    expect(v, `${lang} ${o.kind} ${k}`).toBeTruthy();
                    expect(v, `${lang} ${o.kind} ${k}`).not.toMatch(/\{\{|opp\.|undefined|null|NaN/);
                }
            }
        }
    });
    it('reads number first and names the category or merchant', () => {
        expect(opportunityText(of('category_above_baseline'), ctx())).toMatchObject({ title: '€79 more on Dining than usual', body: '€100.5 so far, against €21.5 at the same point of your earlier periods.', action: 'Set budget of €35' });
        expect(opportunityText(of('merchant_frequency'), ctx())).toMatchObject({ title: '4 visits to Tabaccheria Centrale: €24', body: 'About €6 each time. One fewer visit a week adds up to €24 a month.', action: 'Show these' });
        expect(opportunityText(of('price_creep'), ctx()).title).toBe('Netflix went up by €3 a month');
        expect(opportunityText(of('subscription_review'), ctx()).body).toBe('€143.88 a year. The same charge for 12 months: a good moment to check you still use it.');
        expect(opportunityText(of('fixed_cost'), ctx())).toMatchObject({ action: 'Mark recurring', badge: 'Fixed cost' });
        expect(opportunityText(of('debt_cost'), ctx()).body).toBe('3% of your income, in 1 payments (Klarna).');
        expect(opportunityText(of('uncategorised_blind_spot'), ctx()).action).toBe('Categorise 6');
        expect(opportunityText(of('goal_boost'), ctx()).title).toBe('Emergency fund: 32 months sooner');
        const store = opportunityText(of('cheaper_store'), ctx());
        expect(store.title).toBe('Lidl is cheaper than Conad on 2 things you buy');
        expect(store.why).toContain('25%');
        expect(store.examples[0]).toBe('Latte intero: €1.09 against €1.49 per l');
    });
});

describe('opportunityHref', () => {
    it('lists open on the exact dates the card was computed over', () => {
        const freq = opportunityHref(of('merchant_frequency'));
        expect(freq).toBe('/activity?m=r%3A2026-10-27..2026-11-12&merchant=tabaccheria+centrale');
        const f = parseFilters(new URLSearchParams(freq.split('?')[1]));
        expect(f).toMatchObject({ month: 'r:2026-10-27..2026-11-12', merchants: ['tabaccheria centrale'] });
        expect(parseFilters(new URLSearchParams(opportunityHref(of('uncategorised_blind_spot')).split('?')[1]))).toMatchObject({ month: 'r:2026-10-27..2026-11-12', uncategorised: true });
        expect(parseFilters(new URLSearchParams(opportunityHref(of('debt_cost')).split('?')[1]))).toMatchObject({ groupIds: ['g-debts'] });
        expect(parseFilters(new URLSearchParams(opportunityHref(of('cheaper_store')).split('?')[1]))).toMatchObject({ categories: ['Groceries'], merchants: ['conad'] });
        expect(opportunityHref(of('subscription_review'))).toMatch(/^\/activity\?m=r%3A2025-12-11\.\.2026-11-12&merchant=spotify$/);
    });
    it('a budget opens the prefilled budget sheet; recurring and goal are done in place', () => {
        expect(opportunityHref(of('category_above_baseline'), { periodSpec: 'c:2026-10' })).toBe('/plan?m=c%3A2026-10&budget=Dining&amount=35');
        expect(opportunityHref(of('fixed_cost'))).toBeNull();
        expect(opportunityHref(of('goal_boost'))).toBeNull();
    });
});

describe('trustedExplanation', () => {
    const o = of('category_above_baseline');
    it('shows the AI sentence only while its figures are the card figures', () => {
        expect(trustedExplanation(o, { explanation: 'Dining is €79 above your usual €21.50.', howTo: 'A €35 budget would hold it.' })).toEqual({ explanation: 'Dining is €79 above your usual €21.50.', howTo: 'A €35 budget would hold it.' });
        expect(trustedExplanation(o, { explanation: 'Dining is €64 above your usual.' })).toBeNull(); // yesterday's number
        expect(trustedExplanation(o, { explanation: 'Dining is €79 above usual.', howTo: 'Cut €50 a week.' })).toEqual({ explanation: 'Dining is €79 above usual.', howTo: null });
        expect(trustedExplanation(o, null)).toBeNull();
        expect(trustedExplanation(o, { explanation: '  ' })).toBeNull();
    });
});
