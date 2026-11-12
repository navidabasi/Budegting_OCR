import { Link } from 'react-router-dom';
import { ChevronRight, PiggyBank } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { opportunityText } from '../../services/opportunityText';
import { totalMonthlySaving } from '../../services/savingsOpportunities';

/** Home teaser for "Ways to save": how many ideas, what they add up to and the top one. The whole card opens Insights. */
export default function SaveTeaser({ opportunities = [], periodSpec }) {
    const { t, localizeCategory, isRtl, languageCode } = useTranslation();
    const { short, money } = useMoney();
    if (opportunities.length === 0) return null;
    const total = totalMonthlySaving(opportunities);
    const date = (d) => new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00`));
    const top = opportunityText(opportunities[0], { t, money, localizeCategory, date });
    return (
        <Link to={periodSpec ? `/insights?m=${encodeURIComponent(periodSpec)}` : '/insights'} className="flex items-start gap-3 rounded-[20px] bg-surface px-4 py-3.5 text-ink shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line" data-testid="save-teaser">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mint text-forest-ink">
                <PiggyBank size={18} aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[15px] font-semibold leading-snug">{t('home.saveTeaser.title')}</span>
                    <span className="text-xs font-semibold text-forest-ink">{total > 0 ? t('home.saveTeaser.amount', { count: opportunities.length, amount: short(total) }) : t('home.saveTeaser.count', { count: opportunities.length })}</span>
                </span>
                <span className="text-[13px] leading-snug text-ink-muted">{top.title}</span>
            </span>
            <ChevronRight size={18} aria-hidden="true" className={`mt-2 shrink-0 text-ink-faint ${isRtl ? 'rotate-180' : ''}`} />
        </Link>
    );
}
