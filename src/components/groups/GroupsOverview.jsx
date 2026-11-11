import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Card } from '../ui';
import { GroupAvatar } from './GroupAvatar';
import { GroupAmount } from './GroupAmount';
import { useTranslation } from '../../languages/useTranslation';
import { groupSummaries, splitGroups } from '../../utils/groupStats';

/**
 * Compact list of groups with their total and count for the period (Home card, Plan > Groups). Groups with activity in the period
 * first (largest first), then pinned ones; at most `limit`. Renders nothing when the user has no groups and `hideEmpty`.
 */
export default function GroupsOverview({ groups: all = [], transactions = [], period, currency, limit = 4, title, hideEmpty = false, className = '', testId = 'groups-overview' }) {
    const { t } = useTranslation();
    const rows = useMemo(() => {
        const { groups } = splitGroups(all);
        return groupSummaries(groups, transactions, period)
            .sort((a, b) => b.period.out + b.period.in - (a.period.out + a.period.in) || (b.group.isPinned ? 1 : 0) - (a.group.isPinned ? 1 : 0) || b.lastDate.localeCompare(a.lastDate))
            .slice(0, limit);
    }, [all, transactions, period, limit]);
    if (rows.length === 0 && hideEmpty) return null;
    return (
        <section className={`flex flex-col gap-2 ${className}`} data-testid={testId}>
            <div className="flex items-center justify-between px-0.5">
                <h2 className="font-display text-[17px] font-bold text-ink">{title || t('groups.homeTitle')}</h2>
                <Link to="/groups" className="flex h-11 items-center gap-0.5 text-[13px] font-semibold text-forest-ink">
                    {rows.length ? t('groups.seeAll') : t('groups.manage')}
                    <ChevronRight size={15} className="rtl:rotate-180" aria-hidden="true" />
                </Link>
            </div>
            {rows.length === 0 ? (
                <p className="rounded-[14px] bg-tint px-3.5 py-3 text-sm text-ink-muted">{t('groups.emptyBody')}</p>
            ) : (
                <Card padded={false} className="px-4 py-0.5">
                    <ul>
                        {rows.map(({ group, period: p }) => (
                            <li key={group.id} className="border-b border-line last:border-0">
                                <Link to={`/groups/${group.id}`} className="flex min-h-[56px] items-center gap-3 py-2">
                                    <GroupAvatar group={group} size={32} />
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-[15px] font-medium text-ink">{group.name}</span>
                                        <span className="text-xs text-ink-muted">{t('groups.countPeriod', { count: p.count })}</span>
                                    </span>
                                    <GroupAmount totals={p} currency={currency} className="shrink-0 text-[15px] text-ink" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </section>
    );
}
