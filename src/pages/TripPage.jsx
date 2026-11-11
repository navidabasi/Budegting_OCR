import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { Amount, Sheet } from '../components/ui';
import StartTripSheet from '../components/plan/StartTripSheet';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { useAppStore } from '../store/appStore';
import { useUpdateGroup } from '../data/hooks';
import { usePlanData } from '../hooks/usePlanData';
import { useMoney } from '../hooks/useMoney';
import { useTranslation } from '../languages/useTranslation';
import { dateKey } from '../utils/monthMath';
import { tripPace, tripState, tripTotals } from '../utils/tripMath';
import { typeOf } from '../utils/money';

const fmt = (key, lang, opts) => {
    try {
        return new Intl.DateTimeFormat(`${lang}-u-ca-gregory-nu-latn`, opts).format(new Date(`${key}T00:00:00`));
    } catch {
        return key;
    }
};

/** Trip page (docs/design/Trip.dc.html): hero, category split, latest transactions, Add to trip, End trip. */
export default function TripPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { t, languageCode, localizeCategory, isRtl } = useTranslation();
    const { short, num } = useMoney();
    const openQuickAdd = useAppStore((s) => s.openQuickAdd);
    const showToast = useAppStore((s) => s.showToast);
    const updateGroup = useUpdateGroup();
    const { transactions, trips, accounts, loading } = usePlanData();
    const [editOpen, setEditOpen] = useState(false);
    const [endOpen, setEndOpen] = useState(false);
    const trip = trips.find((x) => x.id === id) || null;
    const today = new Date();

    const totals = useMemo(() => (trip ? tripTotals(trip, transactions, { today }) : null), [trip, transactions]); // eslint-disable-line react-hooks/exhaustive-deps
    const latest = useMemo(
        () => transactions.filter((tx) => tx.groupId === id && typeOf(tx) !== 'transfer').sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
        [transactions, id]
    );
    const accountName = (aid) => accounts.find((a) => a.id === aid)?.name;

    if (loading) return <LoadingSpinner className="pb-20" />;
    if (!trip) {
        return (
            <main className="flex flex-col items-center gap-3 px-8 pt-24 text-center">
                <p className="text-ink-muted">{t('trips.notFound')}</p>
                <Link to="/plan?tab=trips" className="flex h-12 items-center rounded-2xl bg-forest px-5 font-semibold text-white">
                    {t('trips.backToTrips')}
                </Link>
            </main>
        );
    }

    const state = tripState(trip, today);
    const Back = isRtl ? ChevronRight : ChevronLeft;
    const start = trip.startsOn ? dateKey(trip.startsOn) : null;
    const end = trip.endsOn ? dateKey(trip.endsOn) : null;
    const range = start ? `${fmt(start, languageCode, { weekday: 'short', day: 'numeric', month: 'short' })}${end ? ` – ${fmt(end, languageCode, { weekday: 'short', day: 'numeric', month: 'short' })}` : ` – ${t('trips.openEnded')}`}` : '';
    const dayText = totals.daysElapsed > 0 ? (totals.days ? t('trips.dayOf', { day: Math.min(totals.daysElapsed, totals.days), days: totals.days }) : t('trips.dayN', { day: totals.daysElapsed })) : '';
    const pace = tripPace(totals);
    const perDayBudget = totals.budget && totals.days ? totals.budget / totals.days : null;
    const currency = trip.currency || undefined;
    const splitNote = Math.abs(totals.yourShare - totals.total) > 0.005;
    const monthName = fmt(start || dateKey(today), languageCode, { month: 'long' });
    const maxCat = totals.byCategory.reduce((m, c) => Math.max(m, c.total), 0);

    const endTrip = async () => {
        const todayKey = dateKey(today);
        try {
            await updateGroup(trip.id, { isActive: false, endsOn: !end || end > todayKey ? todayKey : end });
            showToast(t('trips.ended', { name: trip.name }), 'success');
            setEndOpen(false);
        } catch {
            showToast(t('trips.sheet.failed'), 'error');
        }
    };
    const addToTrip = () => openQuickAdd({ initial: { groupId: trip.id, groupName: trip.name, currency: trip.currency || undefined } });
    const activityParams = new URLSearchParams({ group: trip.id, m: 'all' });

    return (
        <main className="flex min-h-[100dvh] flex-col pb-[calc(88px+env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),16px)]">
                <button type="button" onClick={() => navigate(-1)} aria-label={t('common.actions.back')} className="flex h-11 w-11 items-center justify-center rounded-full text-ink">
                    <Back size={22} aria-hidden="true" />
                </button>
                <span className="text-[13px] font-semibold uppercase tracking-[.06em] text-ink-muted">{t(`trips.state.${state}`)}</span>
                {state === 'active' ? (
                    <button type="button" onClick={() => setEndOpen(true)} className="h-11 rounded-xl px-3 text-sm font-semibold text-forest-ink">
                        {t('trips.end')}
                    </button>
                ) : (
                    <button type="button" onClick={() => setEditOpen(true)} className="h-11 rounded-xl px-3 text-sm font-semibold text-forest-ink">
                        {t('trips.edit')}
                    </button>
                )}
            </div>

            <section className="mx-5 mb-3 mt-1 flex flex-col gap-2.5 rounded-3xl bg-[#1F4E79] p-5 text-white dark:bg-[#183A5C]" data-testid="trip-hero">
                <div className="flex items-end justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <h1 className="truncate font-display text-[28px] font-bold leading-[1.05] tracking-tight">{trip.name}</h1>
                        <span className="text-[13px] opacity-85">{[range, dayText, trip.companions?.length ? t('trips.with', { names: trip.companions.join(', ') }) : ''].filter(Boolean).join(' · ')}</span>
                    </div>
                    <span className="rounded-[10px] bg-white/15 px-2.5 py-1 text-xs font-semibold">{trip.currency || ''}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                    <Amount value={totals.total} className="text-[42px] font-semibold leading-none tracking-tight" />
                    {totals.budget ? <span className="font-mono text-base opacity-85">{t('budgets.of', { amount: short(totals.budget, currency) })}</span> : null}
                </div>
                {totals.budget ? (
                    <div className="relative h-2 rounded bg-white/20" role="progressbar" aria-valuemin={0} aria-valuemax={totals.budget} aria-valuenow={Math.min(totals.total, totals.budget)} aria-label={trip.name}>
                        <div className="h-full rounded bg-white" style={{ width: `${Math.max(0, Math.min(100, totals.budgetPct))}%` }} />
                        {pace !== null ? <span aria-hidden="true" className="absolute -top-[3px] h-3.5 w-0.5 bg-[#FFD88A]" style={{ insetInlineStart: `${pace * 100}%` }} /> : null}
                    </div>
                ) : null}
                <div className="flex items-baseline text-[13px] opacity-90">
                    <span>{t('trips.perDay')}</span>
                    <span className="lead !opacity-50" aria-hidden="true" />
                    <span className="mono-num">
                        {num(totals.perDay)}
                        {perDayBudget ? ` · ${t('trips.budgetPerDay', { amount: num(perDayBudget) })}` : ''}
                    </span>
                </div>
                <div className="flex items-baseline text-[13px] opacity-90">
                    <span>{splitNote ? t('trips.yourShareSplit') : t('trips.yourShare')}</span>
                    <span className="lead !opacity-50" aria-hidden="true" />
                    <span className="mono-num">{num(totals.yourShare)}</span>
                </div>
                <div className="flex items-baseline text-[13px] opacity-90">
                    <span>{t('trips.keptOut', { month: monthName })}</span>
                    <span className="lead !opacity-50" aria-hidden="true" />
                    <span>{trip.excludeFromBudgets !== false ? t('trips.yes') : t('trips.no')}</span>
                </div>
            </section>

            <div className="flex flex-col gap-3 px-5">
                {state === 'active' ? (
                    <div className="flex items-center gap-2.5 rounded-[14px] bg-savings-soft px-3.5 py-2.5 text-[13px] text-savings">
                        <ShieldCheck size={18} aria-hidden="true" className="shrink-0" />
                        <span>{end ? t('trips.autoUntil', { date: fmt(end, languageCode, { weekday: 'short', day: 'numeric', month: 'short' }) }) : t('trips.autoUntilEnd')}</span>
                    </div>
                ) : null}

                {totals.byCategory.length > 0 ? (
                    <div className="rounded-[18px] bg-surface px-4 py-1 shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line" data-testid="trip-categories">
                        {totals.byCategory.map((c) => (
                            <div key={c.category} className="flex flex-col gap-1.5 border-b border-line py-2.5 last:border-0">
                                <div className="flex items-baseline text-sm text-ink">
                                    <span className="font-medium">{localizeCategory(c.category)}</span>
                                    <span className="lead" aria-hidden="true" />
                                    <Amount value={c.total} />
                                </div>
                                <div className="h-1.5 overflow-hidden rounded bg-line">
                                    <div className="h-full bg-[#1F4E79] dark:bg-[#6FA3D6]" style={{ width: `${maxCat ? (c.total / (totals.total > 0 ? totals.total : maxCat)) * 100 : 0}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : null}

                <div className="flex items-baseline justify-between px-0.5">
                    <h2 className="font-display text-[17px] font-bold text-ink">{t('trips.latest')}</h2>
                    {latest.length > 0 ? (
                        <Link to={`/activity?${activityParams.toString()}`} className="flex h-11 items-center text-[13px] font-semibold text-forest-ink">
                            {t('trips.all', { count: latest.length })}
                        </Link>
                    ) : null}
                </div>
                {latest.length === 0 ? (
                    <p className="rounded-[14px] bg-tint px-3.5 py-3 text-sm text-ink-muted">{t('trips.noTransactions')}</p>
                ) : (
                    <div className="rounded-[18px] bg-surface px-4 py-0.5 shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line">
                        {latest.slice(0, 5).map((tx) => (
                            <Link key={tx.id} to={`/receipts/${tx.id}`} className="flex min-h-[56px] items-center gap-3 border-b border-line py-2 last:border-0">
                                <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-[14px] bg-tint text-[10px] font-semibold uppercase leading-tight text-ink-muted">
                                    <span>{fmt(dateKey(tx.date), languageCode, { weekday: 'short' })}</span>
                                    <span className="text-sm text-ink">{Number(String(tx.date).slice(8, 10))}</span>
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-[15px] font-medium text-ink">{tx.merchant || t('dashboard.topMerchants.unknown')}</span>
                                    <span className="truncate text-xs text-ink-muted">{[typeOf(tx) === 'income' ? t('quickAdd.income') : localizeCategory(tx.category), accountName(tx.accountId), tx.splitData ? t('trips.split') : null].filter(Boolean).join(' · ')}</span>
                                </span>
                                <Amount value={typeOf(tx) === 'income' ? -Number(tx.total) : Number(tx.total)} className="text-[15px]" />
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            <div className="fixed inset-x-0 bottom-0 z-40 bg-ground/95 backdrop-blur" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
                <div className="mx-auto flex max-w-[520px] gap-2 px-5 pt-2.5">
                    <button type="button" onClick={addToTrip} className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl bg-forest text-[15px] font-semibold text-white">
                        <Plus size={20} aria-hidden="true" />
                        {t('trips.addTo')}
                    </button>
                    <button type="button" onClick={() => setEditOpen(true)} className="flex h-[52px] shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-line-strong bg-surface px-5 text-sm font-semibold text-ink">
                        <Pencil size={16} aria-hidden="true" />
                        {t('trips.edit')}
                    </button>
                </div>
            </div>

            <StartTripSheet open={editOpen} onClose={() => setEditOpen(false)} trip={trip} />
            <Sheet open={endOpen} onClose={() => setEndOpen(false)} label={t('trips.end')}>
                <div className="flex flex-col gap-3 px-5 pb-2">
                    <h2 className="font-display text-lg font-bold text-ink">{t('trips.endTitle', { name: trip.name })}</h2>
                    <p className="text-sm text-ink-muted">{t('trips.endBody', { total: short(totals.total, currency) })}</p>
                    <button type="button" onClick={endTrip} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white">
                        {t('trips.end')}
                    </button>
                    <button type="button" onClick={() => setEndOpen(false)} className="h-12 rounded-[18px] text-sm font-semibold text-ink-muted">
                        {t('trips.keepGoing')}
                    </button>
                </div>
            </Sheet>
        </main>
    );
}
