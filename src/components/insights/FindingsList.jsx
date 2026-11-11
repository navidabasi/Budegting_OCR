import { Link } from 'react-router-dom';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { findingHref, findingText } from '../../services/insightText';

const TAG = {
    high: 'bg-[#FDE7DB] text-[#A33A0A] dark:bg-[#4A2414] dark:text-[#FFB48A]',
    medium: 'bg-warn-soft text-warn-ink',
    low: 'bg-tint text-ink-muted',
    positive: 'bg-mint text-forest-ink',
};

/** Deterministic findings from insightsEngine, each linking to the filtered Activity / Budgets / Savings screen. */
export default function FindingsList({ findings }) {
    const { t, localizeCategory } = useTranslation();
    const { short } = useMoney();
    if (findings.length === 0) return <p className="rounded-[14px] bg-tint px-3.5 py-3 text-sm text-ink-muted">{t('insights.noFindings')}</p>;
    return (
        <ul className="rounded-[20px] bg-surface px-4 py-0.5 shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line" data-testid="findings">
            {findings.map((f) => {
                const { title, body } = findingText(f, { t, money: (n) => short(n), localizeCategory });
                return (
                    <li key={f.id} className="border-b border-line last:border-0">
                        <Link to={findingHref(f)} className="flex min-h-[64px] items-start gap-3 py-3">
                            <span className={`mt-0.5 w-[68px] shrink-0 rounded-lg px-1.5 py-1 text-center text-[11px] font-bold uppercase tracking-wide ${TAG[f.severity] || TAG.low}`}>{t(`insights.tag.${f.severity}`)}</span>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="text-[15px] font-semibold leading-snug text-ink">{title}</span>
                                <span className="text-[13px] leading-snug text-ink-muted">{body}</span>
                            </span>
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}
