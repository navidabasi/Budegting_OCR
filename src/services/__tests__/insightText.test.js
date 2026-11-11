import { describe, it, expect } from 'vitest';
import { findingHref, findingText } from '../insightText';
import { INSIGHT_KEYS } from '../insightsEngine';
import { TRANSLATIONS, loadLanguage, tForLanguage } from '../../languages';

const ctx = { t: (k, p) => tForLanguage('en', k, p), money: (n) => `€${n}`, localizeCategory: (c) => c };

describe('findingText', () => {
    it('translates with formatted money and localised category', () => {
        const f = { i18nKey: 'insight.category_up', params: { category: 'Dining', pct: 38, current: 212, average: 154, amount: 58 }, title: 'x', body: 'y' };
        expect(findingText(f, ctx)).toEqual({ title: 'Dining is up 38%', body: 'Dining is €212 this month against a 3-month average of €154 (+€58).' });
    });
    it('whole-month budget label', () => {
        const f = { i18nKey: 'insight.budget_over', params: { label: 'Total', category: undefined, spent: 2100, budget: 2000, over: 100 } };
        expect(findingText(f, ctx).title).toBe('Whole month exceeded');
    });
    it('falls back to the English text for unknown keys', () => {
        expect(findingText({ i18nKey: 'insight.nope', title: 'T', body: 'B' }, ctx)).toEqual({ title: 'T', body: 'B' });
    });
    it('every INSIGHT_KEY has a title and body in all 7 languages', async () => {
        await Promise.all(['it', 'de', 'es', 'fr', 'fa', 'ar'].map(loadLanguage));
        for (const lang of Object.keys(TRANSLATIONS)) {
            for (const key of INSIGHT_KEYS) {
                const [, name] = key.split('.');
                expect(TRANSLATIONS[lang].insight[name].title, `${lang} ${key}`).toBeTruthy();
                expect(TRANSLATIONS[lang].insight[name].body, `${lang} ${key}`).toBeTruthy();
            }
        }
    });
});

describe('findingHref', () => {
    it('links to filtered screens', () => {
        expect(findingHref({ link: { screen: 'activity', params: { m: '2026-11', category: 'Dining' } } })).toBe('/activity?m=2026-11&cat=Dining');
        expect(findingHref({ link: { screen: 'activity', params: { m: '2026-11', category: 'uncategorised' } } })).toBe('/activity?m=2026-11&uncat=1');
        expect(findingHref({ link: { screen: 'budgets', params: { m: '2026-11', category: 'Dining' } } })).toBe('/plan?m=2026-11');
        expect(findingHref({ link: { screen: 'savings', params: { m: '2026-11' } } })).toBe('/plan?m=2026-11&tab=savings');
        expect(findingHref({ link: { screen: 'transaction', params: { id: 'abc' } } })).toBe('/receipts/abc');
    });
});
