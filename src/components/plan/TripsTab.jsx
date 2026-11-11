import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plane, Plus } from 'lucide-react';
import { Amount, Card, ProgressBar } from '../ui';
import StartTripSheet from './StartTripSheet';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { dateKey } from '../../utils/monthMath';
import { tripPace, tripState, tripTotals } from '../../utils/tripMath';

function range(trip, lang) {
    const f = (k, o) => new Intl.DateTimeFormat(`${lang}-u-ca-gregory-nu-latn`, o).format(new Date(`${dateKey(k)}T00:00:00`));
    if (!trip.startsOn) return '';
    const a = f(trip.startsOn, { day: 'numeric', month: 'short' });
    return trip.endsOn ? `${a} – ${f(trip.endsOn, { day: 'numeric', month: 'short', year: 'numeric' })}` : a;
}

/** Plan > Trips: active trip, upcoming and past trips with totals, "Start a trip". */
export default function TripsTab({ data }) {
    const { t, languageCode } = useTranslation();
    const { short } = useMoney();
    const { trips, transactions } = data;
    const [startOpen, setStartOpen] = useState(false);
    const today = new Date();
    const rows = useMemo(
        () =>
            trips
                .map((trip) => ({ trip, state: tripState(trip, today), totals: tripTotals(trip, transactions, { today }) }))
                .sort((a, b) => String(b.trip.startsOn || '').localeCompare(String(a.trip.startsOn || ''))),
        [trips, transactions] // eslint-disable-line react-hooks/exhaustive-deps
    );
    const active = rows.filter((r) => r.state === 'active');
    const upcoming = rows.filter((r) => r.state === 'upcoming');
    const past = rows.filter((r) => r.state === 'ended');

    const item = ({ trip, totals }) => (
        <li key={trip.id} className="border-b border-line last:border-0">
            <Link to={`/trips/${trip.id}`} className="flex min-h-[60px] items-center gap-3 py-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-savings-soft text-savings">
                    <Plane size={18} aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-medium text-ink">{trip.name}</span>
                    <span className="truncate text-xs text-ink-muted">{[range(trip, languageCode), t('trips.count', { count: totals.count })].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="flex flex-col items-end">
                    <Amount value={totals.total} className="text-[15px]" />
                    {totals.budget ? <span className="text-xs text-ink-muted">{t('budgets.of', { amount: short(totals.budget, trip.currency || undefined) })}</span> : null}
                </span>
                <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-faint rtl:rotate-180" />
            </Link>
        </li>
    );

    return (
        <div className="flex flex-col gap-3">
            <button type="button" onClick={() => setStartOpen(true)} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-forest text-base font-semibold text-white">
                <Plus size={20} aria-hidden="true" />
                {t('trips.start')}
            </button>
            {rows.length === 0 ? <p className="rounded-[14px] bg-tint px-3.5 py-3 text-sm text-ink-muted">{t('trips.empty')}</p> : null}
            {active.map(({ trip, totals }) => (
                <Link key={trip.id} to={`/trips/${trip.id}`} className="flex flex-col gap-2 rounded-[20px] bg-[#1F4E79] p-4 text-white dark:bg-[#183A5C]" data-testid="active-trip">
                    <span className="flex items-baseline justify-between">
                        <span className="text-[13px] font-semibold uppercase tracking-[.06em] opacity-85">{t('trips.state.active')}</span>
                        <span className="text-xs opacity-85">{range(trip, languageCode)}</span>
                    </span>
                    <span className="font-display text-2xl font-bold">{trip.name}</span>
                    <span className="flex items-baseline gap-1.5">
                        <Amount value={totals.total} className="text-[30px] font-semibold leading-none" />
                        {totals.budget ? <span className="font-mono text-sm opacity-85">{t('budgets.of', { amount: short(totals.budget, trip.currency || undefined) })}</span> : null}
                    </span>
                    {totals.budget ? <ProgressBar value={totals.total} max={totals.budget} pace={tripPace(totals)} status={totals.total > totals.budget ? 'over' : 'ok'} label={trip.name} className="!bg-white/20" /> : null}
                </Link>
            ))}
            {upcoming.length > 0 ? (
                <>
                    <h2 className="px-0.5 pt-1 font-display text-[17px] font-bold text-ink">{t('trips.upcoming')}</h2>
                    <Card className="!rounded-[18px] !py-0.5"><ul>{upcoming.map(item)}</ul></Card>
                </>
            ) : null}
            {past.length > 0 ? (
                <>
                    <h2 className="px-0.5 pt-1 font-display text-[17px] font-bold text-ink">{t('trips.past')}</h2>
                    <Card className="!rounded-[18px] !py-0.5"><ul>{past.map(item)}</ul></Card>
                </>
            ) : null}
            <StartTripSheet open={startOpen} onClose={() => setStartOpen(false)} />
        </div>
    );
}
