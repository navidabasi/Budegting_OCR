import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConversionNote from '../components/common/ConversionNote';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpDown, Search, Sparkles, Tags, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Chip, IconButton, Sheet } from '../components/ui';
import DayGroup from '../components/activity/DayGroup';
import FilterBar from '../components/activity/FilterBar';
import MonthStrip from '../components/activity/MonthStrip';
import PickerSheet from '../components/activity/PickerSheet';
import CategoriseSheet from '../components/activity/CategoriseSheet';
import TransactionRow from '../components/activity/TransactionRow';
import ActivityList from '../components/activity/ActivityList';
import ActivityTable from '../components/activity/ActivityTable';
import DetailPane from '../components/activity/DetailPane';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useScrollMemory } from '../hooks/useScrollMemory';
import SyncChip from '../components/sync/SyncChip';
import EmptyState from '../components/common/EmptyState';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { useAppStore } from '../store/appStore';
import { useAccounts, useCreateTransaction, useDeleteTransaction, useDemoData, useGroupsData, useSettings, useTransactions } from '../data/hooks';
import { useRecordSyncStates } from '../data/syncHooks';
import { usePeriod } from '../hooks/usePayCycle';
import { periodSpecOf } from '../utils/period';
import { periodFromSpec } from '../utils/payCycle';
import { useCategories } from '../hooks/useCategories';
import { useReceiptNavigation } from '../hooks/useNavigation';
import { useCategoryChange } from '../hooks/useCategoryChange';
import { useTranslation } from '../languages/useTranslation';
import { applyFilters, groupByDay, isUncategorised, isUnpaid, parseFilters, serializeFilters, summarize } from '../utils/activityFilters';

const UNDO_MS = 6000;

function dayLabel(key, now, languageCode, t, withMonth) {
    const d = new Date(`${key}T00:00:00`);
    if (Number.isNaN(d.getTime())) return key;
    const part = (opts) => new Intl.DateTimeFormat(languageCode, opts).format(d);
    const short = `${part({ weekday: 'short' })} ${part({ day: 'numeric' })}${withMonth ? ` ${part({ month: 'short' })}` : ''}`; // "Mon 10" (design)
    const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - d) / 86400000);
    if (diff === 0) return `${t('quickAdd.today')} · ${short}`;
    if (diff === 1) return `${t('quickAdd.yesterday')} · ${short}`;
    return short;
}

/** Activity: every transaction grouped by day, with filters, search, sort, swipe actions, virtualised. */
export default function ActivityPage() {
    const { t, languageCode, localizeCategory } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const showToast = useAppStore((s) => s.showToast);
    const currentUserId = useAppStore((s) => s.currentUser?.userId);
    const { transactions, loading } = useTransactions();
    const { accounts } = useAccounts();
    const { groups } = useGroupsData();
    const { defaultCurrency } = useSettings();
    const categoryList = useCategories();
    const changeCategory = useCategoryChange();
    const deleteTransaction = useDeleteTransaction();
    const createTransaction = useCreateTransaction();
    const syncStates = useRecordSyncStates(transactions);
    const { toReceiptDetail } = useReceiptNavigation();
    const { seedDemoData } = useDemoData();

    const [searchOpen, setSearchOpen] = useState(!!searchParams.get('q'));
    const [sortOpen, setSortOpen] = useState(false);
    const [aiOpen, setAiOpen] = useState(false);
    const [categoryFor, setCategoryFor] = useState(null);
    const [hidden, setHidden] = useState(() => new Set()); // swiped-away rows waiting for the undo window to end
    const timers = useRef(new Map());

    const p = usePeriod();
    const defaultSpec = periodSpecOf(p.current);
    const filters = useMemo(() => parseFilters(searchParams, new Date(), { defaultSpec }), [searchParams, defaultSpec]);
    const activePeriod = useMemo(() => periodFromSpec(filters.month, p.config) || p.period, [filters.month, p.config, p.period]);
    // Tablet and PC keep the open transaction in the URL (?sel=) so filters, selection and back navigation stay together
    const bp = useBreakpoint();
    const split = bp !== 'phone';
    const desk = bp === 'desktop';
    const selectedId = searchParams.get('sel') || '';
    const setFilters = useCallback(
        (patch) => {
            const next = serializeFilters({ ...filters, ...patch }, new Date(), { defaultSpec });
            if (selectedId) next.set('sel', selectedId);
            setSearchParams(next, { replace: true });
        },
        [filters, setSearchParams, defaultSpec, selectedId]
    );
    const select = useCallback(
        (id) =>
            setSearchParams(
                (prev) => {
                    const n = new URLSearchParams(prev);
                    if (id) n.set('sel', id);
                    else n.delete('sel');
                    return n;
                },
                { replace: true }
            ),
        [setSearchParams]
    );
    const paneRef = useRef(null);
    const detailRef = useRef(null);
    const [paneEl, setPaneEl] = useState(null);
    const onPaneRef = useCallback((el) => {
        paneRef.current = el;
        setPaneEl(el);
    }, []);

    const categoryNames = useMemo(() => categoryList.map((c) => (typeof c === 'string' ? c : c.name)).filter((n) => n !== 'Income' && n !== 'Transfer'), [categoryList]);
    const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

    const visible = useMemo(() => transactions.filter((tx) => !hidden.has(tx.id)), [transactions, hidden]);
    const filtered = useMemo(() => applyFilters(visible, filters, { period: activePeriod }), [visible, filters, activePeriod]);
    const items = useMemo(() => groupByDay(filtered), [filtered]);
    const summary = useMemo(() => summarize(filtered), [filtered]);
    const counts = useMemo(() => {
        const rest = applyFilters(visible, { ...filters, tracking: '', uncategorised: false }, { ignoreMonth: false, period: activePeriod });
        return { unpaid: rest.filter(isUnpaid).length, uncategorised: rest.filter(isUncategorised).length };
    }, [visible, filters, activePeriod]);

    // ----- delete with undo (the real delete waits for the undo window) -----
    const commitDelete = useCallback(
        async (tx) => {
            timers.current.delete(tx.id);
            try {
                await deleteTransaction(tx.id);
            } catch (err) {
                console.error('[Activity] delete failed', err);
                showToast(t('quickAdd.saveFailed'), 'error');
            }
            setHidden((h) => {
                const n = new Set(h);
                n.delete(tx.id);
                return n;
            });
        },
        [deleteTransaction, showToast, t]
    );
    const handleDelete = useCallback(
        (tx) => {
            setHidden((h) => new Set(h).add(tx.id));
            timers.current.set(tx.id, { tx, timer: setTimeout(() => commitDelete(tx), UNDO_MS) });
            showToast(t('activity.deleted', { merchant: tx.merchant || t('dashboard.topMerchants.unknown') }), 'info', {
                duration: UNDO_MS,
                action: {
                    label: t('quickAdd.undo'),
                    onClick: () => {
                        const entry = timers.current.get(tx.id);
                        if (entry) clearTimeout(entry.timer);
                        timers.current.delete(tx.id);
                        setHidden((h) => {
                            const n = new Set(h);
                            n.delete(tx.id);
                            return n;
                        });
                    },
                },
            });
        },
        [commitDelete, showToast, t]
    );
    // Leaving the page finishes pending deletes immediately
    useEffect(
        () => () => {
            for (const { tx, timer } of timers.current.values()) {
                clearTimeout(timer);
                deleteTransaction(tx.id).catch(() => createTransaction(tx));
            }
            timers.current.clear();
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    const handleCategory = async (tx, category) => {
        setCategoryFor(null);
        try {
            await changeCategory(tx, category);
        } catch {
            showToast(t('quickAdd.saveFailed'), 'error');
        }
    };

    // back from a detail page: same filters (they are in the URL) and the same place in the list
    useScrollMemory(`activity:${searchParams.toString().replace(/(^|&)sel=[^&]*/, '')}`, { ready: !loading && items.length > 0, getEl: () => (split && !desk ? paneRef.current : null) });

    if (loading) return <LoadingSpinner className="pb-20" />;

    const now = new Date();
    const spansMonths = filters.month === 'all';
    const hasFilters = filters.type || filters.categories.length || filters.accountId || filters.groupId || filters.tracking || filters.uncategorised || filters.merchant || filters.q;
    const sortOptions = [
        { value: 'date:desc', label: t('activity.sortNewest') },
        { value: 'date:asc', label: t('activity.sortOldest') },
        { value: 'amount:desc', label: t('activity.sortAmountHigh') },
        { value: 'amount:asc', label: t('activity.sortAmountLow') },
    ];

    const open = (tx) => (split ? select(tx.id) : toReceiptDetail(tx.id));
    const renderItem = (item) =>
        item.kind === 'day' ? (
            <DayGroup label={dayLabel(item.key, now, languageCode, t, spansMonths)} total={item.total} currency={defaultCurrency} />
        ) : (
            <TransactionRow
                tx={item.tx}
                accountName={accountById.get(item.tx.accountId)}
                toAccountName={accountById.get(item.tx.toAccountId)}
                syncState={syncStates.get(item.tx.id)?.overall}
                onOpen={open}
                onDelete={handleDelete}
                onChangeCategory={setCategoryFor}
            />
        );
    const rows = desk ? items.filter((i) => i.kind === 'tx').map((i) => i.tx) : [];

    return (
        <div className={split ? 'flex h-[100dvh] overflow-hidden' : ''} data-testid="activity-layout" data-layout={bp}>
        <main
            ref={onPaneRef}
            className={split ? `relative flex min-w-0 flex-col pt-3 ${desk ? 'flex-1' : 'w-[min(420px,46vw)] shrink-0 overflow-y-auto border-e border-line pb-28'}` : 'pb-32 pt-[max(env(safe-area-inset-top),16px)]'}
        >
            <div className="flex items-center justify-between px-5 pb-1 pt-4">
                <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">{t('nav.activity')}</h1>
                <div className="flex gap-2">
                    <IconButton label={t('activity.search')} icon={Search} variant="surface" aria-pressed={searchOpen} onClick={() => setSearchOpen((o) => !o)} />
                    <IconButton label={t('activity.sort')} icon={ArrowUpDown} variant="surface" onClick={() => setSortOpen(true)} />
                    <Link to="/groups" aria-label={t('receipts.page.groups')} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink shadow-[0_1px_2px_rgba(16,33,27,.08)] dark:ring-1 dark:ring-line">
                        <Tags size={20} aria-hidden="true" />
                    </Link>
                </div>
            </div>

            {searchOpen ? (
                <div className="flex items-center gap-2 px-5 pb-1 pt-2">
                    <input
                        type="search"
                        autoFocus
                        inputMode="search"
                        aria-label={t('activity.search')}
                        placeholder={t('activity.searchPlaceholder')}
                        value={filters.q}
                        onChange={(e) => setFilters({ q: e.target.value })}
                        className="h-11 min-w-0 flex-1 rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink"
                    />
                    <IconButton label={t('activity.clear')} icon={X} onClick={() => { setFilters({ q: '' }); setSearchOpen(false); }} />
                </div>
            ) : null}

            <div className="px-5">
                <SyncChip className="mb-1" />
                <FilterBar filters={filters} onChange={setFilters} p={p} categoryNames={categoryNames} accounts={accounts} unpaidCount={counts.unpaid} uncategorisedCount={counts.uncategorised} />
                {filters.groupId ? (
                    <div className="pb-2">
                        <Chip size="sm" selected icon={X} onClick={() => setFilters({ groupId: '' })}>
                            {groups.find((g) => g.id === filters.groupId)?.name || t('receipts.page.groups')}
                        </Chip>
                    </div>
                ) : null}
                {filters.merchant ? (
                    <div className="pb-2">
                        <Chip size="sm" selected icon={X} onClick={() => setFilters({ merchant: '' })}>
                            {filters.merchant}
                        </Chip>
                    </div>
                ) : null}
                {counts.uncategorised > 0 ? (
                    <div className="pb-2">
                        <Chip size="sm" tone="suggested" icon={Sparkles} onClick={() => setAiOpen(true)} data-testid="categorise-ai">
                            {t('categorise.action')}
                        </Chip>
                    </div>
                ) : null}
                <ConversionNote transactions={filtered} className="mb-1 px-1" />
                <MonthStrip count={summary.count} income={summary.income} expense={summary.expense} expenseShare={summary.expenseShare} currency={defaultCurrency} />
            </div>

            {items.length === 0 ? (
                <div className="px-5 pt-6">
                    <EmptyState
                        message={hasFilters ? t('activity.noMatches') : t('activity.empty')}
                        action={
                            hasFilters ? (
                                <button type="button" onClick={() => setSearchParams({}, { replace: true })} className="mt-2 h-11 rounded-xl px-4 text-sm font-semibold text-forest-ink">
                                    {t('activity.clearFilters')}
                                </button>
                            ) : (
                                <div className="flex flex-col items-center gap-1">
                                    <p className="text-sm text-ink-muted">{t('activity.emptyHint')}</p>
                                    {transactions.length === 0 ? (
                                        <button type="button" onClick={() => seedDemoData()} className="mt-1 h-11 rounded-xl px-4 text-sm font-semibold text-forest-ink">
                                            {t('activity.trySample')}
                                        </button>
                                    ) : null}
                                </div>
                            )
                        }
                    />
                </div>
            ) : desk ? (
                <div className="mt-3 flex min-h-0 flex-1 flex-col">
                    <ActivityTable
                        rows={rows}
                        selectedId={selectedId}
                        onSelect={select}
                        onActivate={() => detailRef.current?.focus()}
                        onClear={() => select('')}
                        sort={{ sort: filters.sort, dir: filters.dir }}
                        onSort={(next) => setFilters(next)}
                        accountById={accountById}
                        syncStates={syncStates}
                        currency={defaultCurrency}
                    />
                </div>
            ) : (
                <ActivityList items={items} renderItem={renderItem} label={t('nav.activity')} scrollEl={split ? paneEl : null} />
            )}

            <CategoriseSheet open={aiOpen} onClose={() => setAiOpen(false)} transactions={transactions} categoryNames={categoryNames} userId={currentUserId} />
            <PickerSheet
                open={sortOpen}
                title={t('activity.sort')}
                options={sortOptions}
                selected={`${filters.sort}:${filters.dir}`}
                onPick={(v) => {
                    const [sort, dir] = v.split(':');
                    setFilters({ sort, dir });
                    setSortOpen(false);
                }}
                onClose={() => setSortOpen(false)}
            />
            <Sheet open={!!categoryFor} onClose={() => setCategoryFor(null)} label={t('activity.changeCategory')}>
                <div className="px-5 pb-3">
                    <h2 className="pb-1 font-display text-lg font-bold text-ink">{t('activity.changeCategory')}</h2>
                    {categoryFor ? <p className="pb-3 text-sm text-ink-muted">{categoryFor.merchant}</p> : null}
                    <div className="flex max-h-[50dvh] flex-wrap gap-2 overflow-y-auto pb-2">
                        {categoryNames.map((n) => (
                            <Chip key={n} selected={categoryFor?.category === n} onClick={() => handleCategory(categoryFor, n)}>
                                {localizeCategory(n)}
                            </Chip>
                        ))}
                    </div>
                </div>
            </Sheet>
        </main>
        {split ? <DetailPane ref={detailRef} id={selectedId} onClose={() => select('')} /> : null}
        </div>
    );
}
