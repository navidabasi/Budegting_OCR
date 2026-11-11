import Amount from '../ui/Amount';
import { useMoney } from '../../hooks/useMoney';
import { useTranslation } from '../../languages/useTranslation';

/** "47 transactions ········ +2.350,00  −1.240,30" */
export default function MonthStrip({ count, income, expense, currency, expenseShare }) {
    const { t } = useTranslation();
    const { money } = useMoney();
    const split = expenseShare !== undefined && Math.abs(expenseShare - expense) >= 0.005;
    return (
        <div className="flex flex-col gap-1 rounded-[14px] bg-surface px-3.5 py-2.5 text-[13px] shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line" data-testid="month-strip">
            <div className="flex items-baseline">
                <span className="font-semibold text-ink">{t('activity.transactionsCount', { count })}</span>
                <span className="lead" aria-hidden="true" />
                <span className="flex items-baseline gap-2.5">
                    {income > 0 ? <Amount value={income} currency={currency} sign tone="income" /> : null}
                    <Amount value={-expense} currency={currency} className="text-ink" />
                </span>
            </div>
            {split ? <span className="text-xs text-ink-muted" data-testid="share-note">{t('basis.activityShare', { amount: money(expenseShare) })}</span> : null}
        </div>
    );
}
