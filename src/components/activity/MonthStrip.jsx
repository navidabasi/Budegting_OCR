import Amount from '../ui/Amount';
import { useTranslation } from '../../languages/useTranslation';

/** "47 transactions ········ +2.350,00  −1.240,30" */
export default function MonthStrip({ count, income, expense, currency }) {
    const { t } = useTranslation();
    return (
        <div className="flex items-baseline rounded-[14px] bg-surface px-3.5 py-2.5 text-[13px] shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line" data-testid="month-strip">
            <span className="font-semibold text-ink">{t('activity.transactionsCount', { count })}</span>
            <span className="lead" aria-hidden="true" />
            {income > 0 ? <Amount value={income} currency={currency} sign tone="income" className="me-2.5" /> : null}
            <Amount value={-expense} currency={currency} className="text-ink" />
        </div>
    );
}
