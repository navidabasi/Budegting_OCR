import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { usePlanData } from '../../hooks/usePlanData';
import { usePeople } from '../../hooks/usePeople';
import { useMoney } from '../../hooks/useMoney';
import { useTranslation } from '../../languages/useTranslation';
import { fromCents, iOwe, owedToMe, personBalances } from '../../utils/splits';

/** Entry to the Shared view with the open amounts; hidden until something is shared. */
export default function SharedLink() {
    const { t, isRtl } = useTranslation();
    const { money, currency } = useMoney();
    const { transactions } = usePlanData();
    const { people } = usePeople();
    const b = useMemo(() => personBalances(transactions, people), [transactions, people]);
    if (!b.length) return null;
    return (
        <Link to="/shared" className="flex min-h-[56px] items-center gap-3 rounded-[20px] bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line" data-testid="shared-link">
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold text-ink">{t('shared.title')}</span>
                <span className="truncate text-xs text-ink-muted">{t('shared.linkHint', { owed: money(fromCents(owedToMe(b)), currency), owe: money(fromCents(iOwe(b)), currency) })}</span>
            </span>
            <ChevronRight size={18} className={`shrink-0 text-ink-faint ${isRtl ? 'rotate-180' : ''}`} aria-hidden="true" />
        </Link>
    );
}
