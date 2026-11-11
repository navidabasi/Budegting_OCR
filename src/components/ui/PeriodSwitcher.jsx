import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import Chip from './Chip';
import DateField from './DateField';
import Segmented from './Segmented';
import Sheet from './Sheet';
import { monthLabel } from '../../hooks/useMoney';
import { addMonths } from '../../utils/monthMath';
import { cycleRange } from '../../utils/payCycle';
import { formatRange, periodSpecOf } from '../../utils/period';
import { useTranslation } from '../../languages/useTranslation';

/** "9 days left" / "Last day" / "Completed" / "Starts in 3 days" for the period shown. */
export function periodStatusText(t, progress) {
    if (progress.state === 'current') return progress.daysLeft <= 1 ? t('period.lastDay') : t('period.daysLeft', { count: progress.daysLeft });
    if (progress.state === 'past') return t('period.completed');
    return t('period.upcoming');
}

/**
 * "‹ 12 Oct – 11 Nov ›" with "9 days left" under it. Tap the dates to pick another period: pay cycle (default), calendar
 * month or a custom range. `p` is usePeriod().
 */
export default function PeriodSwitcher({ p, className = '', showStatus = true }) {
    const { t, isRtl } = useTranslation();
    const [open, setOpen] = useState(false);
    const Prev = isRtl ? ChevronRight : ChevronLeft;
    const Next = isRtl ? ChevronLeft : ChevronRight;
    const btn = 'flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink';
    const kindLabel = p.kind === 'cycle' ? t('period.cycle') : p.kind === 'month' ? t('period.month') : t('period.custom');
    return (
        <div className={`flex flex-col gap-1 ${className}`} data-testid="period-switcher" data-kind={p.kind}>
            <div className="inline-flex items-center gap-0.5 self-start rounded-full bg-surface p-0.5 shadow-[0_1px_2px_rgba(16,33,27,.08)] dark:ring-1 dark:ring-line">
                <button type="button" onClick={p.prev} aria-label={t('period.prev')} className={`${btn} text-ink`}>
                    <Prev size={18} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="flex min-h-[44px] min-w-[120px] items-center justify-center gap-1.5 px-2 text-sm font-semibold text-ink" aria-live="polite" data-testid="period-label">
                    <CalendarRange size={15} className="shrink-0 text-ink-muted" aria-hidden="true" />
                    {p.label}
                </button>
                <button type="button" onClick={p.next} disabled={!p.canNext} aria-label={t('period.next')} className={`${btn} ${p.canNext ? 'text-ink' : 'text-ink-faint'}`}>
                    <Next size={18} aria-hidden="true" />
                </button>
            </div>
            {showStatus ? (
                <p className="px-1 text-xs text-ink-muted" data-testid="period-status">
                    {kindLabel} · {periodStatusText(t, p.progress)}
                </p>
            ) : null}
            <PeriodPickerSheet open={open} onClose={() => setOpen(false)} p={p} />
        </div>
    );
}

/** Choose a period: pay cycles (last 12), calendar months (last 12) or a custom range. */
export function PeriodPickerSheet({ open, onClose, p, onAll, allSelected = false }) {
    const { t, languageCode } = useTranslation();
    const navigate = useNavigate();
    const [kind, setKind] = useState(p.kind);
    const [from, setFrom] = useState(p.period.start);
    const [to, setTo] = useState(p.period.end);
    const pick = (spec) => {
        p.setSpec(spec);
        onClose();
    };
    const cycles = Array.from({ length: 12 }, (_, i) => addMonths(p.current.id, -i)).map((id) => ({ id, range: cycleRange(id, p.config) }));
    const months = Array.from({ length: 12 }, (_, i) => addMonths(p.today.slice(0, 7), -i));
    const row = (selected, label, onClick, key) => (
        <Chip key={key} selected={selected} onClick={onClick} className="!h-11 justify-start">
            {label}
        </Chip>
    );
    return (
        <Sheet open={open} onClose={onClose} label={t('period.pick')}>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-2" data-testid="period-picker">
                <h2 className="font-display text-lg font-bold text-ink">{t('period.pick')}</h2>
                {onAll ? (
                    <Chip selected={allSelected} onClick={() => { onAll(); onClose(); }} className="!h-11 justify-start">
                        {t('activity.allTime')}
                    </Chip>
                ) : null}
                <Segmented
                    fill
                    ariaLabel={t('period.pick')}
                    value={kind}
                    onChange={setKind}
                    options={[
                        { value: 'cycle', label: t('period.cycle') },
                        { value: 'month', label: t('period.month') },
                        { value: 'range', label: t('period.custom') },
                    ]}
                />
                {kind === 'cycle' ? (
                    <>
                        {!p.config.configured ? (
                            <div className="flex flex-col gap-2 rounded-[14px] bg-warn-soft px-3.5 py-3 text-sm text-warn-ink">
                                <p>{t('period.setPayday')}</p>
                                <button
                                    type="button"
                                    className="h-11 self-start rounded-[12px] border border-warn-edge bg-surface px-3.5 text-sm font-semibold"
                                    onClick={() => {
                                        onClose();
                                        navigate('/settings');
                                    }}
                                >
                                    {t('period.openSettings')}
                                </button>
                            </div>
                        ) : null}
                        <div className="flex flex-col gap-2">
                            {cycles.map(({ id, range }) => row(p.kind === 'cycle' && p.key === id, formatRange(range, languageCode, p.today), () => pick(id === p.current.id ? '' : `c:${id}`), id))}
                        </div>
                    </>
                ) : null}
                {kind === 'month' ? <div className="flex flex-col gap-2">{months.map((m) => row(p.kind === 'month' && p.key === m, monthLabel(m, languageCode, { long: true }), () => pick(m), m))}</div> : null}
                {kind === 'range' ? (
                    <div className="flex flex-col gap-3">
                        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                            {t('period.from')}
                            <DateField value={from} onChange={setFrom} allowEmpty={false} />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                            {t('period.to')}
                            <DateField value={to} onChange={setTo} min={from} allowEmpty={false} />
                        </label>
                        <button type="button" disabled={!from || !to || from > to} onClick={() => pick(periodSpecOf({ kind: 'range', start: from, end: to }))} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40">
                            {t('period.apply')}
                        </button>
                    </div>
                ) : null}
            </div>
        </Sheet>
    );
}
