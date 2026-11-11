import { Link } from 'react-router-dom';
import { ChevronRight, Sparkles } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { findingText } from '../../services/insightText';

/** The top deterministic finding of the month; the whole card links to /insights. */
export default function InsightCard({ finding }) {
    const { t, localizeCategory, isRtl } = useTranslation();
    const { short } = useMoney();
    if (!finding) return null;
    const { title, body } = findingText(finding, { t, money: (n) => short(n), localizeCategory });
    return (
        <Link to="/insights" className="flex items-start gap-3 rounded-[20px] bg-surface px-4 py-3.5 text-ink shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line" data-testid="insight-card">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mint text-forest-ink">
                <Sparkles size={18} aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-semibold leading-snug">{title}</span>
                <span className="text-[13px] leading-snug text-ink-muted">{body}</span>
            </span>
            <ChevronRight size={18} aria-hidden="true" className={`mt-2 shrink-0 text-ink-faint ${isRtl ? 'rotate-180' : ''}`} />
        </Link>
    );
}
