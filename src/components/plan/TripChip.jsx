import { Plane, X } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

/** Visible, removable "Trip: Lisbon" chip shown where a transaction joined the active trip automatically. */
export default function TripChip({ name, onRemove }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            onClick={onRemove}
            aria-label={t('trips.removeFromTrip', { name })}
            className="inline-flex h-11 max-w-full items-center gap-2 self-start rounded-full bg-savings-soft px-3.5 text-sm font-semibold text-savings focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink"
        >
            <Plane size={15} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{t('trips.chip', { name })}</span>
            <X size={14} aria-hidden="true" className="shrink-0" />
        </button>
    );
}
