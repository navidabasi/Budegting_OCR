import { Suspense, lazy, useMemo, useState } from 'react';
import ConversionNote from '../components/common/ConversionNote';
import { Plane, Settings } from 'lucide-react';
import { IconButton, PeriodSwitcher } from '../components/ui';
import MonthReceipt from '../components/home/MonthReceipt';
import TripBanner from '../components/home/TripBanner';
import InsightCard from '../components/home/InsightCard';
import BudgetStrip from '../components/home/BudgetStrip';
import UpcomingBills from '../components/home/UpcomingBills';
import EmptyHome from '../components/home/EmptyHome';
import DraftBanner from '../components/home/DraftBanner';
import BreakdownLink from '../components/home/BreakdownLink';
import SharedLink from '../components/home/SharedLink';
import SyncChip from '../components/sync/SyncChip';
import StartTripSheet from '../components/plan/StartTripSheet';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { useAppStore } from '../store/appStore';
import { useActiveTrip } from '../data/hooks';
import { usePlanData } from '../hooks/usePlanData';
import { usePeriod } from '../hooks/usePayCycle';
import { periodSpecOf } from '../utils/period';
import { useTranslation } from '../languages/useTranslation';
import { computeInsights } from '../services/insightsEngine';
import { categoryBudgets, WHOLE_MONTH } from '../utils/budgetMath';
import { monthTotals } from '../utils/money';
import { tripTotals } from '../utils/tripMath';
import { getTrackingStatus } from '../utils/tracking';

const HomeCharts = lazy(() => import('../components/home/HomeCharts'));

/** Home (docs/design/Main.dc.html): the month as a receipt, trip banner, top insight, budgets strip, upcoming bills, charts. */
export default function HomePage() {
    const { t, languageCode } = useTranslation();
    const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
    const p = usePeriod();
    const month = p.period;
    const { transactions, trips, accounts, budgets, goals, currency, loading } = usePlanData();
    const { trip: activeTrip } = useActiveTrip();
    const [tripOpen, setTripOpen] = useState(false);
    const today = useMemo(() => new Date(), []);

    const totals = useMemo(() => monthTotals(transactions, month, { trips, accounts }), [transactions, month, trips, accounts]);
    const rows = useMemo(() => categoryBudgets(budgets, transactions, month, trips, { today, accounts }), [budgets, transactions, month, trips, accounts, today]);
    const finding = useMemo(() => computeInsights({ transactions, budgets, goals, accounts, trips, month, today, currency })[0] || null, [transactions, budgets, goals, accounts, trips, month, today, currency]);
    const unpaid = useMemo(
        () => transactions.filter((tx) => (tx.transactionType || 'expense') === 'expense' && getTrackingStatus(tx) === 'open').sort((a, b) => String(a.date).localeCompare(String(b.date))),
        [transactions]
    );
    const tripStats = useMemo(() => (activeTrip ? tripTotals(activeTrip, transactions, { today }) : null), [activeTrip, transactions, today]);

    if (loading) return <LoadingSpinner className="pb-20" />;

    const title = p.kind === 'month' ? p.label : p.kind === 'cycle' ? (p.isCurrent ? t('period.titleCurrent') : t('period.titleCycle')) : t('period.custom');
    const empty = transactions.length === 0;

    return (
        <main className="flex flex-col gap-3.5 px-5 pb-32 pt-[max(env(safe-area-inset-top),16px)]">
            <div className="flex items-end justify-between pt-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-semibold uppercase tracking-[.08em] text-ink-muted">{t('home.eyebrow')}</span>
                    <h1 className="font-display text-[32px] font-bold leading-[1.05] tracking-tight text-ink">
                        {title.charAt(0).toUpperCase() + title.slice(1)}
                    </h1>
                </div>
                <div className="flex gap-2">
                    {!activeTrip ? <IconButton label={t('trips.start')} icon={Plane} variant="surface" onClick={() => setTripOpen(true)} /> : null}
                    <IconButton label={t('navigation.settings')} icon={Settings} variant="surface" onClick={() => setSidebarOpen(true)} />
                </div>
            </div>
            <PeriodSwitcher p={p} />

            <SyncChip />
            <DraftBanner />

            {activeTrip && tripStats ? <TripBanner trip={activeTrip} totals={tripStats} /> : null}

            {empty ? (
                <EmptyHome />
            ) : (
                <>
                    <MonthReceipt month={month} totals={totals} wholeBudget={rows.find((r) => r.category === WHOLE_MONTH) || null} today={today} />
                    <ConversionNote transactions={transactions} period={month} hint className="px-1" />
                    <InsightCard finding={finding} />
                    <BudgetStrip rows={rows} month={periodSpecOf(month)} />
                    <BreakdownLink month={periodSpecOf(month)} />
                    <SharedLink />
                    <UpcomingBills unpaid={unpaid} today={today} />
                    <Suspense fallback={<div className="h-48 animate-pulse rounded-[20px] bg-line" aria-hidden="true" />}>
                        <HomeCharts transactions={transactions} trips={trips} month={month} today={today} />
                    </Suspense>
                </>
            )}
            <StartTripSheet open={tripOpen} onClose={() => setTripOpen(false)} />
        </main>
    );
}
