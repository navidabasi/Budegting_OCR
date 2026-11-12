import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_MAP, APP_ROUTES, APP_SCREENS, isAppPath, matchFeatures, screenOfPath } from '../appMap';
import { buildEvidencePack } from '../evidencePack';
import { actionHref } from '../chatApi';
import { sanitizeBody } from '../aiOutbound';
import { en } from '../../languages/en';

const appRoutes = (() => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../App.jsx'), 'utf8');
    return new Set([...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
})();

describe('A-T3 app map', () => {
    it('every route and every entry path exists in App.jsx (a renamed screen fails here)', () => {
        for (const r of APP_ROUTES) expect(appRoutes.has(r), r).toBe(true);
        for (const e of APP_MAP) expect(APP_ROUTES, e.id).toContain(e.path.split('?')[0]);
        for (const s of APP_SCREENS) expect(APP_ROUTES).toContain(s.path);
    });
    it('has ~40 entries with unique ids, lowercase keywords, steps and a translated screen name', () => {
        expect(APP_MAP.length).toBeGreaterThanOrEqual(35);
        expect(new Set(APP_MAP.map((e) => e.id)).size).toBe(APP_MAP.length);
        for (const e of APP_MAP) {
            expect(e.keywords.every((k) => k === k.toLowerCase()), e.id).toBe(true);
            expect(e.steps.length).toBeGreaterThan(10);
            expect(isAppPath(e.path), e.path).toBe(true);
            expect(APP_SCREENS.some((s) => s.screen === e.screen), e.id).toBe(true);
        }
        for (const s of APP_SCREENS) expect(en.appMap.screen[s.screen], s.screen).toBeTruthy();
    });
    it.each([
        ['where do I find my subscriptions', 'subscriptions'],
        ['How do I scan a receipt?', 'scan_receipt'],
        ['how do I import a CSV from my bank', 'import_csv'],
        ['where can I change the language', 'language'],
        ['how do I set a budget', 'budgets'],
        ['how do I mark a bill as paid', 'unpaid_bills'],
        ['how do I add an account', 'accounts'],
        ['how do I start a trip', 'trips'],
        ['where do I see who owes me', 'shared_balances'],
        ['how do I export my data', 'export'],
        ['how do I turn on dark mode', 'appearance'],
        ['dove trovo il ciclo di paga?', 'pay_cycle'],
    ])('%s -> %s', (q, id) => expect(matchFeatures(q)[0]?.id).toBe(id));

    it('the app_help pack names the screen and carries no user data', () => {
        const tx = { id: 't1', merchant: 'Lidl', total: 40, category: 'Groceries', date: '2026-11-03', transactionType: 'expense' };
        const { pack } = buildEvidencePack({ question: 'where do I find my subscriptions?', transactions: [tx], period: '2026-11', today: '2026-11-10' });
        expect(pack.intent).toBe('app_help');
        expect(pack.insufficient).toBeNull();
        const f = pack.facts.find((x) => x.kind === 'app_feature');
        expect(f).toMatchObject({ feature: 'subscriptions', screen: 'insights', path: '/insights' });
        expect(pack.facts.some((x) => x.kind === 'app_screens')).toBe(true);
        expect(pack.facts.some((x) => ['period_summary', 'basis_totals'].includes(x.kind))).toBe(false);
        expect(JSON.stringify(pack)).not.toMatch(/Lidl/);
        // the outbound boundary leaves the app documentation readable
        const out = sanitizeBody('chat', { evidence: pack });
        expect(out.evidence.facts.find((x) => x.kind === 'app_feature')).toMatchObject({ path: '/insights', screen: 'insights' });
        expect(out.evidence.facts.find((x) => x.kind === 'app_feature').steps).toMatch(/Ways to save/);
    });

    it('open_screen links only to the app routes', () => {
        expect(actionHref({ type: 'open_screen', payload: { path: '/activity?tracking=open&m=all' } })).toBe('/activity?tracking=open&m=all');
        expect(actionHref({ type: 'open_screen', payload: { path: '/plan?tab=savings' } })).toBe('/plan?tab=savings');
        for (const p of ['javascript:alert(1)', '/nowhere', '//evil', 'https://x.y', '/admin']) expect(actionHref({ type: 'open_screen', payload: { path: p } }), p).toBeNull();
        expect(screenOfPath('/plan?tab=trips')).toBe('plan');
    });
});
