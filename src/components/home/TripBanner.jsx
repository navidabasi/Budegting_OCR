import { Link } from 'react-router-dom';
import { ChevronRight, Plane } from 'lucide-react';
import { Amount } from '../ui';
import { useTranslation } from '../../languages/useTranslation';

/** "On a trip · Lisbon, day 3 of 4" banner linking to the trip page. */
export default function TripBanner({ trip, totals }) {
    const { t, isRtl } = useTranslation();
    const where = totals.days ? t('home.tripDayOf', { name: trip.name, day: Math.min(totals.daysElapsed, totals.days), days: totals.days }) : t('home.tripDay', { name: trip.name, day: Math.max(totals.daysElapsed, 1) });
    return (
        <Link to={`/trips/${trip.id}`} className="flex min-h-[56px] items-center gap-3 rounded-2xl bg-[#1F4E79] px-3.5 py-2.5 text-white dark:bg-[#183A5C]" data-testid="trip-banner">
            <Plane size={20} aria-hidden="true" className="shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-sm font-semibold">{where}</span>
                <span className="text-xs opacity-85">{t('home.tripJoin')}</span>
            </span>
            <Amount value={totals.total} className="shrink-0 text-[15px] font-semibold" />
            <ChevronRight size={16} aria-hidden="true" className={`shrink-0 opacity-70 ${isRtl ? 'rotate-180' : ''}`} />
        </Link>
    );
}
