import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, FolderOpen, Pin, Plane, Plus } from 'lucide-react';
import { Amount, Card, PageHeader, PeriodSwitcher } from '../components/ui';
import GroupSheet from '../components/groups/GroupSheet';
import { GroupAvatar } from '../components/groups/GroupAvatar';
import { GroupAmount } from '../components/groups/GroupAmount';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { useGroupsData, useSettings, useTransactions } from '../data/hooks';
import { useGroupActions } from '../hooks/useGroupActions';
import { usePeriod } from '../hooks/usePayCycle';
import { useTranslation } from '../languages/useTranslation';
import { groupSummaries, splitGroups } from '../utils/groupStats';
import { tripTotals } from '../utils/tripMath';

/**
 * Groups (pass 3): every group with its total for the selected period and all time, newest activity, pinned first; trips in their
 * own section. Each row opens the group detail (/groups/:id); "New group" creates one in a sheet.
 */
export default function GroupsPage() {
    const { t, languageCode } = useTranslation();
    const p = usePeriod();
    const { groups: all, loading: groupsLoading } = useGroupsData();
    const { transactions, loading: txLoading } = useTransactions();
    const { defaultCurrency } = useSettings();
    const { create } = useGroupActions();
    const [sheetOpen, setSheetOpen] = useState(false);
    const { groups, trips } = useMemo(() => splitGroups(all), [all]);
    const rows = useMemo(() => groupSummaries(groups, transactions, p.period), [groups, transactions, p.period]);
    const tripRows = useMemo(() => trips.map((trip) => ({ trip, totals: tripTotals(trip, transactions, { today: new Date() }) })), [trips, transactions]);

    if (groupsLoading || txLoading) return <LoadingSpinner className="pb-20" />;

    const dateText = (d) => (d ? new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00`)) : '');
    const periodTotal = rows.reduce((a, r) => a + r.period.out, 0);

    return (
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-3.5 px-5 pb-32 pt-[max(env(safe-area-inset-top),16px)]">
            <PageHeader
                back="/activity"
                eyebrow={t('groups.eyebrow')}
                title={t('receipts.page.groups')}
                actions={
                    <button type="button" onClick={() => setSheetOpen(true)} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-forest px-4 text-sm font-semibold text-white" data-testid="new-group">
                        <Plus size={17} aria-hidden="true" />
                        {t('groups.newShort')}
                    </button>
                }
            >
                <PeriodSwitcher p={p} />
            </PageHeader>

            {groups.length === 0 ? (
                <Card className="flex flex-col items-center gap-3 px-6 py-8 text-center" data-testid="groups-empty">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mint text-forest-ink">
                        <FolderOpen size={22} aria-hidden="true" />
                    </span>
                    <p className="text-[15px] font-semibold text-ink">{t('groups.emptyTitle')}</p>
                    <p className="max-w-xs text-sm text-ink-muted">{t('groups.emptyBody')}</p>
                    <button type="button" onClick={() => setSheetOpen(true)} className="h-12 rounded-2xl bg-forest px-5 text-sm font-semibold text-white">
                        {t('groups.new')}
                    </button>
                </Card>
            ) : (
                <section className="flex flex-col gap-2" aria-labelledby="groups-heading">
                    <div className="flex items-baseline justify-between px-0.5">
                        <h2 id="groups-heading" className="font-display text-[17px] font-bold text-ink">{t('groups.sectionGroups', { count: groups.length })}</h2>
                        <span className="text-xs text-ink-muted">
                            {t('groups.periodOut')} <Amount value={periodTotal} currency={defaultCurrency} className="text-xs text-ink" />
                        </span>
                    </div>
                    <Card padded={false} className="px-4 py-0.5">
                        <ul data-testid="groups-list">
                            {rows.map(({ group, period, all: allTime, lastDate }) => (
                                <li key={group.id} className="border-b border-line last:border-0">
                                    <Link to={`/groups/${group.id}`} className="flex min-h-[64px] items-center gap-3 py-2.5" data-testid="group-row">
                                        <GroupAvatar group={group} />
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="flex items-center gap-1.5">
                                                <span className="truncate text-[15px] font-semibold text-ink" data-testid="group-row-name">{group.name}</span>
                                                {group.isPinned ? <Pin size={12} className="shrink-0 text-ink-faint" aria-label={t('groups.pinned')} /> : null}
                                            </span>
                                            <span className="truncate text-xs text-ink-muted">
                                                {[t('groups.countPeriod', { count: period.count }), lastDate ? t('groups.last', { date: dateText(lastDate) }) : t('groups.noneYet')].join(' · ')}
                                            </span>
                                        </span>
                                        <span className="flex shrink-0 flex-col items-end gap-0.5">
                                            <GroupAmount totals={period} currency={defaultCurrency} className="text-[15px] text-ink" />
                                            <span className="text-[11px] text-ink-faint">
                                                {t('groups.allTimeShort')} <GroupAmount totals={allTime} currency={defaultCurrency} className="text-[11px]" />
                                            </span>
                                        </span>
                                        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-faint rtl:rotate-180" />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </Card>
                </section>
            )}

            {tripRows.length > 0 ? (
                <section className="flex flex-col gap-2" aria-labelledby="trips-heading">
                    <div className="flex items-baseline justify-between px-0.5">
                        <h2 id="trips-heading" className="font-display text-[17px] font-bold text-ink">{t('groups.sectionTrips')}</h2>
                        <Link to="/plan?tab=trips" className="flex h-11 items-center text-[13px] font-semibold text-forest-ink">
                            {t('groups.allTrips')}
                        </Link>
                    </div>
                    <Card padded={false} className="px-4 py-0.5">
                        <ul>
                            {tripRows.map(({ trip, totals }) => (
                                <li key={trip.id} className="border-b border-line last:border-0">
                                    <Link to={`/trips/${trip.id}`} className="flex min-h-[60px] items-center gap-3 py-2.5" data-testid="trip-row">
                                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-savings-soft text-savings">
                                            <Plane size={18} aria-hidden="true" />
                                        </span>
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate text-[15px] font-medium text-ink">{trip.name}</span>
                                            <span className="truncate text-xs text-ink-muted">{t('trips.count', { count: totals.count })}</span>
                                        </span>
                                        <Amount value={totals.total} currency={defaultCurrency} className="text-[15px]" />
                                        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-faint rtl:rotate-180" />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </Card>
                </section>
            ) : null}

            <GroupSheet open={sheetOpen} onClose={() => setSheetOpen(false)} existingNames={groups.map((g) => g.name)} onSave={(data) => create(data)} />
        </main>
    );
}
