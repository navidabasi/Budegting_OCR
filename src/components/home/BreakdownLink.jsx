import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../../languages/useTranslation';

/** Entry to the spending breakdown (Home and Budgets). */
export default function BreakdownLink({ month, className = '' }) {
    const { t, isRtl } = useTranslation();
    return (
        <Link to={month ? `/breakdown?m=${month}` : '/breakdown'} className={`flex min-h-[56px] items-center gap-3 rounded-[20px] bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line ${className}`} data-testid="breakdown-link">
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold text-ink">{t('breakdown.title')}</span>
                <span className="truncate text-xs text-ink-muted">{t('breakdown.linkHint')}</span>
            </span>
            <ChevronRight size={18} className={`shrink-0 text-ink-faint ${isRtl ? 'rotate-180' : ''}`} aria-hidden="true" />
        </Link>
    );
}
