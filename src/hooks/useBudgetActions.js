import { useCallback, useMemo } from 'react';
import { useRowMutations } from '../data/hooks';
import { planBudgetRemove, planBudgetSave } from '../utils/budgetEdits';

/** save(category, amount, month) / remove(category, month): run the row operations planned by budgetEdits. */
export function useBudgetActions({ budgets, currency }) {
    const { create, update, remove } = useRowMutations('budgets');
    const run = useCallback(
        async (ops) => {
            for (const op of ops) {
                if (op.op === 'create') await create(op.data);
                else if (op.op === 'update') await update(op.id, op.patch);
                else if (op.op === 'delete') await remove(op.id);
            }
        },
        [create, update, remove]
    );
    return useMemo(
        () => ({
            save: (category, amount, month) => run(planBudgetSave({ budgets, category, amount, month, currency })),
            remove: (category, month) => run(planBudgetRemove({ budgets, category, month })),
        }),
        [run, budgets, currency]
    );
}
