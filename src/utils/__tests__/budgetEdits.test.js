import { describe, it, expect } from 'vitest';
import { planBudgetRemove, planBudgetSave } from '../budgetEdits';
import { activeBudgets } from '../budgetMath';

const B = (id, category, amount, startsOn, endsOn = null) => ({ id, category, amount, currency: 'EUR', startsOn, endsOn });

describe('planBudgetSave', () => {
    it('creates a row starting on the month when none applies', () => {
        expect(planBudgetSave({ budgets: [], category: 'Dining', amount: 180, month: '2026-11' })).toEqual([
            { op: 'create', data: { category: 'Dining', amount: 180, currency: 'EUR', startsOn: '2026-11-01', endsOn: null } },
        ]);
    });
    it('updates the row that starts on that month', () => {
        const ops = planBudgetSave({ budgets: [B('a', 'Dining', 150, '2026-11-01')], category: 'Dining', amount: 200, month: '2026-11' });
        expect(ops).toEqual([{ op: 'update', id: 'a', patch: { amount: 200, currency: 'EUR', endsOn: null } }]);
    });
    it('creates a new row for a later month so earlier months keep the old amount', () => {
        const budgets = [B('a', 'Dining', 150, '2026-09-01')];
        const ops = planBudgetSave({ budgets, category: 'Dining', amount: 200, month: '2026-11' });
        expect(ops[0].op).toBe('create');
        const after = [...budgets, { id: 'n', ...ops[0].data }];
        expect(activeBudgets(after, '2026-10').find((b) => b.category === 'Dining').amount).toBe(150);
        expect(activeBudgets(after, '2026-12').find((b) => b.category === 'Dining').amount).toBe(200);
    });
});

describe('planBudgetRemove', () => {
    it('ends an older open-ended row the day before the month', () => {
        expect(planBudgetRemove({ budgets: [B('a', 'Dining', 150, '2026-09-01')], category: 'Dining', month: '2026-11' })).toEqual([
            { op: 'update', id: 'a', patch: { endsOn: '2026-10-31' } },
        ]);
    });
    it('deletes a row that starts on the month and ends the one before it', () => {
        const budgets = [B('a', 'Dining', 150, '2026-09-01'), B('b', 'Dining', 200, '2026-11-01')];
        expect(planBudgetRemove({ budgets, category: 'Dining', month: '2026-11' })).toEqual([
            { op: 'delete', id: 'b' },
            { op: 'update', id: 'a', patch: { endsOn: '2026-10-31' } },
        ]);
    });
    it('does nothing when no budget applies', () => {
        expect(planBudgetRemove({ budgets: [], category: 'Dining', month: '2026-11' })).toEqual([]);
    });
});
