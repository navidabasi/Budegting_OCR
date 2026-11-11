import { useEffect, useMemo, useState } from 'react';
import { Chip, Sheet } from '../ui';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney, monthLabel } from '../../hooks/useMoney';
import { WHOLE_MONTH, activeBudgets, suggestBudget } from '../../utils/budgetMath';
import { parseLocalNumber } from '../../utils/helpers';

const field = 'h-14 w-full rounded-[14px] border border-line-strong bg-surface px-3.5 font-mono text-2xl text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink';
const lbl = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';

/**
 * Add / edit a budget for `month`. `initial` prefills the sheet (category, amount) - used by the chat's
 * set_budget action, which only ever opens this sheet and never writes by itself.
 * Props: open, onClose, month, budgets (all rows), categoryNames, transactions, trips, accounts, currency,
 *        category (preselected, '*' = whole month), amount (prefill), onSave(category, amount), onRemove(category).
 */
export default function BudgetSheet({ open, onClose, month, budgets, categoryNames, transactions, trips, accounts, category: initialCategory = null, amount: initialAmount = null, onSave, onRemove }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const { short, currency } = useMoney();
    const showToast = useAppStore((s) => s.showToast);
    const [category, setCategory] = useState(initialCategory);
    const [text, setText] = useState('');
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [saving, setSaving] = useState(false);

    const active = useMemo(() => activeBudgets(budgets, month), [budgets, month]);
    const existing = category ? active.find((b) => b.category === category) : null;
    const editing = !!(initialCategory && active.some((b) => b.category === initialCategory));

    useEffect(() => {
        if (!open) return;
        setCategory(initialCategory);
        const row = initialCategory ? active.find((b) => b.category === initialCategory) : null;
        setText(initialAmount != null ? String(initialAmount).replace('.', ',') : row ? String(row.amount).replace('.', ',') : '');
        setConfirmRemove(false);
        setSaving(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initialCategory, initialAmount]);

    const taken = new Set(active.map((b) => b.category));
    const choices = [WHOLE_MONTH, ...categoryNames].filter((c) => editing ? c === initialCategory : !taken.has(c) || c === category);
    const suggestion = useMemo(() => (category ? suggestBudget(transactions, category, month, { trips, accounts }) : null), [category, transactions, month, trips, accounts]);
    const value = parseLocalNumber(text);
    const label = (c) => (c === WHOLE_MONTH ? t('budgets.wholeMonth') : localizeCategory(c));

    const save = async () => {
        if (!category || !(value > 0) || saving) return;
        setSaving(true);
        try {
            await onSave(category, Math.round(value * 100) / 100);
            showToast(t('budgets.sheet.saved'), 'success');
            onClose();
        } catch {
            showToast(t('budgets.sheet.failed'), 'error');
            setSaving(false);
        }
    };
    const remove = async () => {
        setSaving(true);
        try {
            await onRemove(category);
            showToast(t('budgets.sheet.removed'), 'info');
            onClose();
        } catch {
            showToast(t('budgets.sheet.failed'), 'error');
            setSaving(false);
        }
    };

    return (
        <Sheet open={open} onClose={onClose} label={editing ? t('budgets.sheet.titleEdit') : t('budgets.sheet.titleAdd')}>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-2">
                <h2 className="font-display text-lg font-bold text-ink">{editing ? t('budgets.sheet.titleEdit') : t('budgets.sheet.titleAdd')}</h2>
                <div className="flex flex-col gap-2">
                    <span className={lbl}>{t('budgets.sheet.category')}</span>
                    {choices.length <= 1 && !category ? (
                        <p className="text-sm text-ink-muted">{t('budgets.sheet.noCategories')}</p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {choices.map((c) => (
                                <Chip key={c} selected={category === c} onClick={() => !editing && setCategory(c)} disabled={editing && c !== category}>
                                    {label(c)}
                                </Chip>
                            ))}
                        </div>
                    )}
                </div>
                <label className="flex flex-col gap-1.5">
                    <span className={lbl}>
                        {t('budgets.sheet.amount')} · {monthLabel(month, languageCode)}
                    </span>
                    <input className={field} inputMode="decimal" dir="ltr" value={text} placeholder="0" onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, ''))} data-autofocus={editing || !!category ? true : undefined} />
                </label>
                {suggestion ? (
                    <div className="flex items-center justify-between gap-3 rounded-[14px] bg-mint px-3.5 py-2 text-sm text-forest-ink">
                        <span>{t('budgets.sheet.suggestion', { amount: short(suggestion, currency) })}</span>
                        <button type="button" onClick={() => setText(String(suggestion))} className="h-11 min-w-[44px] rounded-xl px-3 font-semibold">
                            {t('budgets.sheet.useSuggestion')}
                        </button>
                    </div>
                ) : null}
                {confirmRemove ? <p className="rounded-[14px] bg-warn-soft px-3.5 py-3 text-sm text-warn-ink">{t('budgets.sheet.removeNote', { month: monthLabel(month, languageCode) })}</p> : null}
            </div>
            <div className="flex flex-col gap-2 px-5 pt-3">
                {confirmRemove ? (
                    <button type="button" onClick={remove} disabled={saving} className="h-14 rounded-[18px] bg-over text-base font-semibold text-white disabled:opacity-40">
                        {t('budgets.sheet.removeConfirm')}
                    </button>
                ) : (
                    <button type="button" onClick={save} disabled={!category || !(value > 0) || saving} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40">
                        {t('budgets.sheet.save')}
                    </button>
                )}
                {existing && editing && !confirmRemove ? (
                    <button type="button" onClick={() => setConfirmRemove(true)} className="h-12 rounded-[18px] text-sm font-semibold text-over-ink">
                        {t('budgets.sheet.remove')}
                    </button>
                ) : null}
            </div>
        </Sheet>
    );
}
