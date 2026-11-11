// Budget edit planning (P4-T3). Pure: turns "set this category's amount from <month> on" / "remove it from <month> on"
// into row operations the page executes through the data layer.
import { activeBudgets } from './budgetMath';
import { addDays, monthStart } from './monthMath';

const day = (v) => String(v || '').slice(0, 10);

/**
 * planBudgetSave({ budgets, category, amount, month, currency })
 * -> [{ op: 'update', id, patch } | { op: 'create', data }]. A row that already starts on `month` is updated; otherwise a
 * new row starting on `month` is created, so earlier months keep their old amount.
 */
export function planBudgetSave({ budgets = [], category, amount, month, currency = 'EUR' }) {
    const start = monthStart(month);
    const active = activeBudgets(budgets, month).find((b) => b.category === category);
    if (active && day(active.startsOn) === start) return [{ op: 'update', id: active.id, patch: { amount: Number(amount), currency: active.currency || currency, endsOn: null } }];
    return [{ op: 'create', data: { category, amount: Number(amount), currency, startsOn: start, endsOn: null } }];
}

/** planBudgetRemove({ budgets, category, month }): stop the budget from `month` on (earlier months keep it). */
export function planBudgetRemove({ budgets = [], category, month }) {
    const start = monthStart(month);
    const prevEnd = addDays(start, -1);
    const active = activeBudgets(budgets, month).find((b) => b.category === category);
    if (!active) return [];
    if (day(active.startsOn) < start) return [{ op: 'update', id: active.id, patch: { endsOn: prevEnd } }];
    const ops = [{ op: 'delete', id: active.id }];
    const older = (budgets || [])
        .filter((b) => b.category === category && b.id !== active.id && day(b.startsOn) < start && (!b.endsOn || day(b.endsOn) >= start))
        .sort((a, b) => day(b.startsOn).localeCompare(day(a.startsOn)))[0];
    if (older) ops.push({ op: 'update', id: older.id, patch: { endsOn: prevEnd } });
    return ops;
}
