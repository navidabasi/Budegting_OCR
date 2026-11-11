import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';
import { monthLabel } from '../../hooks/useMoney';
import Sheet from './Sheet';

const monthShort = (year, index, locale) =>
    new Date(year, index, 1).toLocaleDateString(locale || 'en', { month: 'short' });

/**
 * "‹ Nov 2026 ›" pill (design). The arrows step one month; tapping the label opens a month picker so any month can be
 * reached in two taps. Months after `max` (the current month) are disabled.
 */
export default function MonthSwitcher({ month, onPrev, onNext, onSelect, canNext = true, max, className = '' }) {
    const { t, languageCode, isRtl } = useTranslation();
    const [open, setOpen] = useState(false);
    const [year, setYear] = useState(() => Number(String(month).slice(0, 4)));
    const Prev = isRtl ? ChevronRight : ChevronLeft;
    const Next = isRtl ? ChevronLeft : ChevronRight;
    const maxKey = max || month;
    const maxYear = Number(String(maxKey).slice(0, 4));
    const btn = 'flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink';

    const openPicker = () => {
        setYear(Number(String(month).slice(0, 4)));
        setOpen(true);
    };
    const pick = (key) => {
        onSelect?.(key);
        setOpen(false);
    };

    return (
        <>
            <div className={`inline-flex items-center gap-0.5 rounded-full bg-surface p-0.5 shadow-[0_1px_2px_rgba(16,33,27,.08)] dark:ring-1 dark:ring-line ${className}`}>
                <button type="button" onClick={onPrev} aria-label={t('plan.prevMonth')} className={`${btn} text-ink`}>
                    <Prev size={18} aria-hidden="true" />
                </button>
                {onSelect ? (
                    <button
                        type="button"
                        onClick={openPicker}
                        aria-haspopup="dialog"
                        aria-label={t('plan.pickMonth')}
                        className="flex h-11 min-w-[88px] items-center justify-center gap-1 rounded-full px-1 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink"
                    >
                        <span aria-live="polite">{monthLabel(month, languageCode)}</span>
                        <ChevronDown size={14} aria-hidden="true" className="text-ink-muted" />
                    </button>
                ) : (
                    <span className="min-w-[72px] text-center text-sm font-semibold text-ink" aria-live="polite">
                        {monthLabel(month, languageCode)}
                    </span>
                )}
                <button type="button" onClick={onNext} disabled={!canNext} aria-label={t('plan.nextMonth')} className={`${btn} ${canNext ? 'text-ink' : 'text-ink-faint'}`}>
                    <Next size={18} aria-hidden="true" />
                </button>
            </div>
            {onSelect ? (
                <Sheet open={open} onClose={() => setOpen(false)} label={t('plan.pickMonth')}>
                    <div className="flex flex-col gap-4 px-5 pb-2">
                        <div className="flex items-center justify-between">
                            <button type="button" onClick={() => setYear((y) => y - 1)} aria-label={t('plan.prevYear')} className={`${btn} text-ink`}>
                                <Prev size={20} aria-hidden="true" />
                            </button>
                            <span className="font-display text-lg font-bold text-ink">{year}</span>
                            <button
                                type="button"
                                onClick={() => setYear((y) => Math.min(maxYear, y + 1))}
                                disabled={year >= maxYear}
                                aria-label={t('plan.nextYear')}
                                className={`${btn} ${year >= maxYear ? 'text-ink-faint' : 'text-ink'}`}
                            >
                                <Next size={20} aria-hidden="true" />
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2" role="listbox" aria-label={String(year)}>
                            {Array.from({ length: 12 }, (_, i) => {
                                const key = `${year}-${String(i + 1).padStart(2, '0')}`;
                                const selected = key === month;
                                const disabled = key > maxKey;
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        role="option"
                                        aria-selected={selected}
                                        disabled={disabled}
                                        onClick={() => pick(key)}
                                        className={`h-12 rounded-2xl text-sm font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink ${
                                            selected
                                                ? 'bg-ink text-ground'
                                                : disabled
                                                  ? 'bg-surface text-ink-faint'
                                                  : 'bg-surface text-ink ring-1 ring-line active:bg-mint'
                                        }`}
                                    >
                                        {monthShort(year, i, languageCode)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </Sheet>
            ) : null}
        </>
    );
}
