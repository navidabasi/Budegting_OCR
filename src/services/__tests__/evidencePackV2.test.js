// Assistant v2 (docs/ASSISTANT_V2_PLAN.md): explain and app_help lanes, the category glossary, budget_absent.
import { describe, expect, it } from 'vitest';
import { buildEvidencePack, routeQuestion } from '../evidencePack';

describe('A-T1 router v2: conceptual and app-help questions', () => {
    it.each([
        // the owner's exact questions
        ['why do i need to set a budget for housing', 'explain'],
        ['what is budgeting', 'explain'],
        ['where do I find my subscriptions', 'app_help'],
        // more explain
        ['Why should I budget every month?', 'explain'],
        ['Is it worth having an emergency fund?', 'explain'],
        ['What is inflation?', 'explain'],
        ['What does savings rate mean?', 'explain'],
        ['Do I really need a budget for rent?', 'explain'],
        ['Cosa significa tasso di risparmio?', 'explain'],
        ['Warum sollte ich ein Budget haben?', 'explain'],
        ['¿Qué es un presupuesto?', 'explain'],
        ['Pourquoi devrais-je faire un budget ?', 'explain'],
        ['چرا باید بودجه داشته باشم؟', 'explain'],
        ['لماذا يجب أن أضع ميزانية؟', 'explain'],
        // more app help
        ['How do I scan a receipt?', 'app_help'],
        ['how do I set a budget', 'app_help'],
        ['dove trovo le impostazioni?', 'app_help'],
        ['come faccio a importare un csv?', 'app_help'],
        ['Wo finde ich meine Abos?', 'app_help'],
        ['¿Dónde encuentro mis cuentas?', 'app_help'],
        ['Où trouver mes abonnements ?', 'app_help'],
        ['کجا تنظیمات را پیدا کنم؟', 'app_help'],
        ['أين أجد الاشتراكات؟', 'app_help'],
    ])('%s -> %s', (q, intent) => expect(routeQuestion(q)).toBe(intent));

    it('keeps the data intents where they were', () => {
        expect(routeQuestion('Where can I cut?')).toBe('save_money');
        expect(routeQuestion('How can I save more money?')).toBe('save_money');
        expect(routeQuestion('Dove posso risparmiare?')).toBe('save_money');
        expect(routeQuestion('What is my top supermarket this cycle?')).toBe('top_merchant');
        expect(routeQuestion('What is my average monthly spend on groceries?')).toBe('history');
        expect(routeQuestion('What explains the change versus the previous comparable period?')).toBe('change');
        expect(routeQuestion('Am I on track with my budgets?')).toBe('budgets_goals');
        expect(routeQuestion('What do I owe?')).toBe('owed');
        expect(routeQuestion('Where is my money going?')).toBe('general');
        expect(routeQuestion('Posso permettermi 150 €?')).toBe('afford');
    });
});

import { packNumbers, unsupportedFigures } from '../evidencePack';
import { ownerLike, TODAY } from '../__fixtures__/ownerLike';
import { currentCyclePeriod, normalizeConfig } from '../../utils/payCycle';

describe('A-T2 explain pack: the category the question names, its history and its budget or absence', () => {
    const d = ownerLike();
    const period = currentCyclePeriod(normalizeConfig(d.config), new Date(`${TODAY}T12:00:00Z`));
    const build = (question, extra = {}) => buildEvidencePack({ ...d, period, question, ...extra }).pack;

    it('"why do I need a budget for housing" carries Housing total, history, budget_absent and the glossary', () => {
        const pack = build('why do i need to set a budget for housing');
        expect(pack.intent).toBe('explain');
        expect(pack.insufficient).toBeNull();
        const kinds = pack.facts.map((f) => f.kind);
        expect(kinds).toEqual(expect.arrayContaining(['period_summary', 'category_total', 'history_average', 'budget_absent', 'glossary']));
        const total = pack.facts.find((f) => f.kind === 'category_total');
        expect(total).toMatchObject({ category: 'Housing', amount: 380 });
        expect(total.sharePct).toBeGreaterThan(0);
        const avg = pack.facts.find((f) => f.kind === 'history_average');
        expect(avg).toMatchObject({ category: 'Housing', last3MonthsAverage: 380 });
        expect(pack.facts.find((f) => f.kind === 'budget_absent')).toMatchObject({ category: 'Housing', suggestion: 380, basedOnMonths: 3 });
        expect(pack.facts.find((f) => f.kind === 'glossary').contains).toMatch(/rent/);
        // every figure an answer should quote is in the pack
        const nums = packNumbers(pack);
        for (const n of [380, total.sharePct, avg.averagePerMonth]) expect(nums.has(n)).toBe(true);
        expect(unsupportedFigures('Your rent is 380 € a month, about ' + total.sharePct + ' % of your spending.', pack)).toEqual([]);
    });

    it('a budgeted category gets its budget row instead of budget_absent', () => {
        const pack = build('Why should I have a budget for groceries?');
        expect(pack.facts.find((f) => f.kind === 'budget')).toMatchObject({ category: 'Groceries', budget: 260 });
        expect(pack.facts.some((f) => f.kind === 'budget_absent')).toBe(false);
    });

    it('"what is budgeting" names no category: the biggest categories, never insufficient', () => {
        const pack = build('what is budgeting');
        expect(pack.intent).toBe('explain');
        expect(pack.insufficient).toBeNull();
        expect(pack.facts.filter((f) => f.kind === 'category_total').length).toBeGreaterThan(0);
        expect(pack.facts.some((f) => f.kind === 'glossary')).toBe(false);
        const empty = buildEvidencePack({ question: 'what is budgeting', period: '2026-11', today: '2026-11-10' }).pack;
        expect(empty.insufficient).toBeNull();
    });

    it('budgets_goals also carries a named category it has no budget for', () => {
        const pack = build('How is my budget for dining?', { intent: 'budgets_goals' });
        expect(pack.facts.find((f) => f.kind === 'category_total')).toMatchObject({ category: 'Dining' });
        expect(pack.facts.find((f) => f.kind === 'budget_absent')).toMatchObject({ category: 'Dining' });
        const none = buildEvidencePack({ transactions: d.transactions, period, today: TODAY, question: 'budget for housing', intent: 'budgets_goals' }).pack;
        expect(none.insufficient).toBeNull();
    });
});

describe('B-T2 patterns chat intent', () => {
    it('routes habit questions in the app languages', () => {
        for (const q of ['What are my spending habits?', 'Do I have any spending patterns?', 'When do I spend the most?', 'Quali sono le mie abitudini di spesa?', 'Was sind meine Gewohnheiten?', '¿Cuáles son mis hábitos?', 'Quelles sont mes habitudes ?', 'عادت‌های خرج من چیست؟', 'ما هي عاداتي؟']) expect(routeQuestion(q), q).toBe('patterns');
        expect(routeQuestion('How can I save money?')).toBe('save_money');
    });
    it('"what are my spending habits?" answers from the computed pattern facts only', () => {
        const d = ownerLike();
        const period = currentCyclePeriod(normalizeConfig(d.config), new Date(`${TODAY}T12:00:00Z`));
        const { pack, refs } = buildEvidencePack({ ...d, period, question: 'What are my spending habits?' });
        expect(pack.intent).toBe('patterns');
        const f = pack.facts.filter((x) => x.kind === 'pattern');
        expect(f).toHaveLength(1);
        expect(f[0]).toMatchObject({ patternKind: 'merchant_cadence', merchant: 'Tabaccheria Centrale', everyDays: 5.9, periodStart: '2026-04-27' });
        expect(refs[f[0].refs[0]].txId).toBeTruthy();
        expect(unsupportedFigures('You go to Tabaccheria Centrale about every 5.9 days, 30.15 a month.', pack)).toEqual([]);
        expect(unsupportedFigures('That is 120.00 a month.', pack)).toEqual(['120.00']);
        // hidden patterns are not offered; none at all is answered on the device
        expect(buildEvidencePack({ ...d, period, question: 'my habits', dismissed: { 'pattern_merchant_cadence:tabaccheria centrale': TODAY } }).pack.insufficient).toBe('no_patterns');
    });
});
