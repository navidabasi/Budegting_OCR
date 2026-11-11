import { Suspense, lazy, useMemo, useState } from 'react';
import { Plane, Settings } from 'lucide-react';
import { IconButton, MonthSwitcher } from '../components/ui';
import MonthReceipt from '../components/home/MonthReceipt';
import TripBanner from '../components/home/TripBanner';
import InsightCard from '../components/home/InsightCard';
import BudgetStrip from '../components/home/BudgetStrip';
import UpcomingBills from '../components/home/UpcomingBills';
import EmptyHome from '../components/home/EmptyHome';
import StartTripSheet from '../components/plan/StartTripSheet';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { useAppStore } from '../store/appStore';
import { useActiveTrip } from '../data/hooks';
import { usePlanData } from '../hooks/usePlanData';
import { useSelectedMonth } from '../hooks/useSelectedMonth';
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
    const { month, isCurrent, prev, next, setMonth, current } = useSelectedMonth();
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

    const title = new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { month: 'long' }).format(new Date(`${month}-01T00:00:00`));
    const showYear = month.slice(0, 4) !== String(today.getFullYear());
    const empty = transactions.length === 0;

    return (
        <main className="flex flex-col gap-3.5 px-5 pb-32 pt-[max(env(safe-area-inset-top),16px)]">
            <div className="flex items-end justify-between pt-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-semibold uppercase tracking-[.08em] text-ink-muted">{t('home.eyebrow')}</span>
                    <h1 className="font-display text-[32px] font-bold leading-[1.05] tracking-tight text-ink">
                        {title.charAt(0).toUpperCase() + title.slice(1)}
                        {showYear ? <span className="ms-2 text-xl font-medium text-ink-muted">{month.slice(0, 4)}</span> : null}
                    </h1>
                </div>
                <div className="flex gap-2">
                    {!activeTrip ? <IconButton label={t('trips.start')} icon={Plane} variant="surface" onClick={() => setTripOpen(true)} /> : null}
                    <IconButton label={t('navigation.settings')} icon={Settings} variant="surface" onClick={() => setSidebarOpen(true)} />
                </div>
            </div>
            <MonthSwitcher month={month} onPrev={prev} onNext={next} onSelect={setMonth} max={current} canNext={!isCurrent} className="self-start" />

            {activeTrip && tripStats ? <TripBanner trip={activeTrip} totals={tripStats} /> : null}

            {empty ? (
                <EmptyHome />
            ) : (
                <>
                    <MonthReceipt month={month} totals={totals} wholeBudget={rows.find((r) => r.category === WHOLE_MONTH) || null} today={today} />
                    <InsightCard finding={finding} />
                    <BudgetStrip rows={rows} month={month} />
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
