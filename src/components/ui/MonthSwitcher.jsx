import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';
import { monthLabel } from '../../hooks/useMoney';

/** "‹ Nov 2026 ›" pill (design). Next is disabled while the current month is shown. */
export default function MonthSwitcher({ month, onPrev, onNext, canNext = true, className = '' }) {
    const { t, languageCode, isRtl } = useTranslation();
    const Prev = isRtl ? ChevronRight : ChevronLeft;
    const Next = isRtl ? ChevronLeft : ChevronRight;
    const btn = 'flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink';
    return (
        <div className={`inline-flex items-center gap-0.5 rounded-full bg-surface p-0.5 shadow-[0_1px_2px_rgba(16,33,27,.08)] dark:ring-1 dark:ring-line ${className}`}>
            <button type="button" onClick={onPrev} aria-label={t('plan.prevMonth')} className={`${btn} text-ink`}>
                <Prev size={18} aria-hidden="true" />
            </button>
            <span className="min-w-[72px] text-center text-sm font-semibold text-ink" aria-live="polite">
                {monthLabel(month, languageCode)}
            </span>
            <button type="button" onClick={onNext} disabled={!canNext} aria-label={t('plan.nextMonth')} className={`${btn} ${canNext ? 'text-ink' : 'text-ink-faint'}`}>
                <Next size={18} aria-hidden="true" />
            </button>
        </div>
    );
}
