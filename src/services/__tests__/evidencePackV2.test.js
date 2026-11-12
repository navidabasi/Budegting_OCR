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
