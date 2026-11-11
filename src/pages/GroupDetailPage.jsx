import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, ListFilter, Pencil, Plus } from 'lucide-react';
import { Amount, Card, IconButton, PageHeader, PeriodSwitcher, Segmented } from '../components/ui';
import GroupSheet from '../components/groups/GroupSheet';
import AddToGroupSheet from '../components/groups/AddToGroupSheet';
import { GroupAvatar } from '../components/groups/GroupAvatar';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { useGroupsData, useSettings, useTransactions } from '../data/hooks';
import { useGroupActions } from '../hooks/useGroupActions';
import { usePeriod } from '../hooks/usePayCycle';
import { useTranslation } from '../languages/useTranslation';
import { categoryVisual } from '../utils/categoryVisual.jsx';
import { groupDetail, isTrip, splitGroups } from '../utils/groupStats';
import { periodSpecOf } from '../utils/period';

/** One group (/groups/:id): period and all-time totals, the split by category, its transactions, edit / delete, add transactions. */
export default function GroupDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { t, languageCode, localizeCategory } = useTranslation();
    const p = usePeriod();
    const { groups: all, loading: groupsLoading } = useGroupsData();
    const { transactions, loading: txLoading } = useTransactions();
    const { defaultCurrency } = useSettings();
    const { update, remove, assign } = useGroupActions();
    const [editOpen, setEditOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [scope, setScope] = useState('period');
    const group = all.find((g) => g.id === id) || null;
    const groupById = useMemo(() => new Map(all.map((g) => [g.id, g])), [all]);
    const detail = useMemo(() => groupDetail(group, transactions, p.period), [group, transactions, p.period]);

    if (groupsLoading || txLoading) return <LoadingSpinner className="pb-20" />;
    if (group && isTrip(group)) return <Navigate to={`/trips/${group.id}`} replace />;
    if (!group) {
        return (
            <main className="flex flex-col gap-4 px-5 pb-32 pt-[max(env(safe-area-inset-top),16px)]">
                <PageHeader back="/groups" title={t('groups.notFound')} />
                <Link to="/groups" className="h-11 text-sm font-semibold text-forest-ink">{t('groups.backToGroups')}</Link>
            </main>
        );
    }

    const rows = scope === 'period' ? detail.periodRows : detail.rows;
    const totals = scope === 'period' ? detail.period : detail.all;
    const date = (d) => new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(`${String(d).slice(0, 10)}T00:00:00`));
    const activityHref = `/activity?group=${encodeURIComponent(group.id)}&m=${encodeURIComponent(scope === 'period' ? periodSpecOf(p.period) : 'all')}`;
    const { groups: plain } = splitGroups(all);

    return (
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-3.5 px-5 pb-32 pt-[max(env(safe-area-inset-top),16px)]" data-testid="group-detail">
            <PageHeader
                back="/groups"
                eyebrow={t('groups.eyebrowOne')}
                title={group.name}
                actions={<IconButton label={t('groups.edit')} icon={Pencil} variant="surface" onClick={() => setEditOpen(true)} data-testid="group-edit" />}
            >
                <PeriodSwitcher p={p} />
            </PageHeader>

            <Card className="flex flex-col gap-3 !py-4">
                <div className="flex items-center gap-3">
                    <GroupAvatar group={group} size={44} />
                    <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('groups.thisPeriod')}</span>
                        <span className="flex flex-wrap items-baseline gap-x-3">
                            <Amount value={detail.period.out} currency={defaultCurrency} className="font-display text-[28px] font-semibold leading-tight text-ink" />
                            {detail.period.in > 0 ? <Amount value={detail.period.in} currency={defaultCurrency} sign tone="income" className="text-lg" /> : null}
                        </span>
                    </div>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex flex-col rounded-[14px] bg-tint px-3 py-2">
                        <dt className="text-xs text-ink-muted">{t('groups.transactions')}</dt>
                        <dd className="mono-num text-ink">{detail.period.count}</dd>
                    </div>
                    <div className="flex flex-col rounded-[14px] bg-tint px-3 py-2">
                        <dt className="text-xs text-ink-muted">{t('groups.allTime')}</dt>
                        <dd className="flex flex-wrap gap-x-2">
                            <Amount value={detail.all.out} currency={defaultCurrency} className="text-ink" />
                            {detail.all.in > 0 ? <Amount value={detail.all.in} currency={defaultCurrency} sign tone="income" /> : null}
                        </dd>
                    </div>
                </dl>
                <div className="flex gap-2">
                    <Link to={activityHref} className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-line-strong bg-surface text-sm font-semibold text-ink" data-testid="group-in-activity">
                        <ListFilter size={16} aria-hidden="true" />
                        {t('groups.showInActivity')}
                    </Link>
                    <button type="button" onClick={() => setAddOpen(true)} className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-forest text-sm font-semibold text-white" data-testid="group-add">
                        <Plus size={16} aria-hidden="true" />
                        {t('groups.addTransactions')}
                    </button>
                </div>
            </Card>

            {detail.byCategory.length > 0 ? (
                <section className="flex flex-col gap-2" aria-labelledby="group-cats">
                    <h2 id="group-cats" className="px-0.5 font-display text-[17px] font-bold text-ink">{t('groups.byCategory')}</h2>
                    <Card className="flex flex-col gap-3 !py-3.5">
                        {detail.byCategory.slice(0, 6).map((c) => {
                            const { Icon, bg, fg } = categoryVisual(c.category, c.category === 'Transfer' ? 'transfer' : 'expense');
                            return (
                                <div key={c.category} className="flex items-center gap-3" data-testid="group-cat">
                                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${bg} ${fg}`}>
                                        <Icon size={15} aria-hidden="true" />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                                        <span className="flex items-baseline justify-between gap-2 text-sm">
                                            <span className="truncate text-ink">{localizeCategory(c.category)}</span>
                                            <span className="shrink-0 text-xs text-ink-muted">
                                                <Amount value={c.amount} currency={defaultCurrency} className="text-sm text-ink" /> · {Math.round(c.share * 100)}%
                                            </span>
                                        </span>
                                        <span className="h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
                                            <span className="block h-full origin-left rounded-full rtl:origin-right" style={{ transform: `scaleX(${c.share})`, backgroundColor: group.color || 'rgb(var(--c-forest-ink))' }} />
                                        </span>
                                    </span>
                                </div>
                            );
                        })}
                    </Card>
                </section>
            ) : null}

            <section className="flex flex-col gap-2" aria-labelledby="group-rows">
                <div className="flex items-center justify-between gap-2 px-0.5">
                    <h2 id="group-rows" className="font-display text-[17px] font-bold text-ink">{t('groups.transactionsCount', { count: totals.count })}</h2>
                    <Segmented ariaLabel={t('groups.scope')} value={scope} onChange={setScope} options={[{ value: 'period', label: t('groups.thisPeriodShort') }, { value: 'all', label: t('groups.allTime') }]} />
                </div>
                {rows.length === 0 ? (
                    <p className="rounded-[14px] bg-tint px-3.5 py-3 text-sm text-ink-muted">{scope === 'period' ? t('groups.emptyPeriod') : t('groups.emptyAll')}</p>
                ) : (
                    <Card padded={false} className="px-4 py-0.5">
                        <ul>
                            {rows.map((tx) => {
                                const type = tx.transactionType || 'expense';
                                const { Icon, bg, fg } = categoryVisual(tx.category, type);
                                return (
                                    <li key={tx.id} className="border-b border-line last:border-0">
                                        <Link to={`/receipts/${tx.id}`} className="flex min-h-[58px] items-center gap-3 py-2" data-testid="group-tx">
                                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] ${bg} ${fg}`}>
                                                <Icon size={16} aria-hidden="true" />
                                            </span>
                                            <span className="flex min-w-0 flex-1 flex-col">
                                                <span className="truncate text-[15px] text-ink">{tx.merchant || t('dashboard.topMerchants.unknown')}</span>
                                                <span className="truncate text-xs text-ink-muted">{[date(tx.date), type === 'income' ? t('quickAdd.income') : type === 'transfer' ? t('activity.transferLabel') : localizeCategory(tx.category || 'Other')].join(' · ')}</span>
                                            </span>
                                            <Amount value={tx.total} sign={type === 'income'} tone={type === 'income' ? 'income' : 'default'} className="shrink-0 text-[15px]" />
                                            <ChevronRight size={15} className="shrink-0 text-ink-faint rtl:rotate-180" aria-hidden="true" />
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </Card>
                )}
            </section>

            <GroupSheet
                open={editOpen}
                onClose={() => setEditOpen(false)}
                group={group}
                existingNames={plain.map((g) => g.name)}
                onSave={(data) => update(group, data)}
                onDelete={async (g) => {
                    await remove(g);
                    navigate('/groups', { replace: true });
                }}
            />
            <AddToGroupSheet open={addOpen} onClose={() => setAddOpen(false)} group={group} transactions={transactions} groupById={groupById} onAdd={(ids) => assign(ids, group)} />
        </main>
    );
}
