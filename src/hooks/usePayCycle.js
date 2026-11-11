import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUserPrefs } from './useUserPrefs';
import { addDays, addMonths, daysBetween } from '../utils/monthMath';
import { currentCyclePeriod, cyclePeriod, describeCycle, monthPeriod, normalizeConfig, periodFromSpec, rangePeriod, todayInTimezone } from '../utils/payCycle';
import { formatRange, periodSpecOf } from '../utils/period';
import { setClockTimezone } from '../utils/quickAdd';
import { monthLabel } from './useMoney';
import { useTranslation } from '../languages/useTranslation';

/** The pay-cycle settings (payday rules, timezone, per-cycle start overrides) from the synced prefs: { config, save(rawConfig), loading }. */
export function usePayCycleConfig() {
    const { prefs, setPrefs, loading } = useUserPrefs();
    const config = useMemo(() => normalizeConfig(prefs.payCycle), [prefs.payCycle]);
    useEffect(() => {
        setClockTimezone(config.timezone); // "today" for new entries follows the configured timezone
    }, [config.timezone]);
    const save = useCallback((raw) => setPrefs({ payCycle: raw }), [setPrefs]);
    return { config, save, loading };
}

/**
 * The period every period-scoped screen shows, kept in the URL as `?m=<spec>`:
 *   (none)              the current pay cycle (default; calendar months until a payday is set)
 *   c:2026-10           a pay cycle (id = month of its payday)
 *   2026-11             a calendar month (secondary view)
 *   r:2026-10-01..10-20 a custom range (secondary view)
 *   all                 is not a period (Activity only)
 * Returns { period, kind, key, spec, label, progress, isCurrent, canNext, today, config, setSpec, shift, prev, next, switchKind, setRange }.
 */
export function usePeriod(now = new Date()) {
    const { languageCode } = useTranslation();
    const [params, setParams] = useSearchParams();
    const { config } = usePayCycleConfig();
    const today = useMemo(() => todayInTimezone(config.timezone, now), [config.timezone]); // eslint-disable-line react-hooks/exhaustive-deps
    const current = useMemo(() => currentCyclePeriod(config, now), [config, today]); // eslint-disable-line react-hooks/exhaustive-deps
    const raw = params.get('m') || '';
    const period = useMemo(() => periodFromSpec(raw, config) || current, [raw, config, current]);
    const defaultSpec = periodSpecOf(current);
    const spec = periodSpecOf(period);

    const setSpec = useCallback(
        (next) =>
            setParams(
                (prev) => {
                    const n = new URLSearchParams(prev);
                    if (!next || next === defaultSpec) n.delete('m');
                    else n.set('m', next);
                    return n;
                },
                { replace: true }
            ),
        [setParams, defaultSpec]
    );

    const shift = useCallback(
        (n) => {
            if (period.kind === 'cycle') setSpec(`c:${addMonths(period.id, n)}`);
            else if (period.kind === 'month') setSpec(addMonths(period.id, n));
            else {
                const len = daysBetween(period.start, period.end) + 1;
                setSpec(`r:${addDays(period.start, n * len)}..${addDays(period.end, n * len)}`);
            }
        },
        [period, setSpec]
    );

    const switchKind = useCallback(
        (kind) => {
            if (kind === 'cycle') setSpec(periodSpecOf(cyclePeriod(current.id, config)));
            else if (kind === 'month') setSpec(today.slice(0, 7));
            else setSpec(`r:${current.start}..${current.end}`);
        },
        [current, config, today, setSpec]
    );

    const setRange = useCallback((start, end) => start && end && start <= end && setSpec(`r:${start}..${end}`), [setSpec]);

    const progress = useMemo(() => describeCycle(period, today), [period, today]);
    const label = useMemo(() => (period.kind === 'month' ? monthLabel(period.id, languageCode, { long: true }) : formatRange(period, languageCode, today)), [period, languageCode, today]);
    const canNext = period.end < today; // a later period exists to show only once this one is over

    return useMemo(
        () => ({
            period,
            kind: period.kind,
            key: period.id,
            spec,
            label,
            progress,
            isCurrent: progress.state === 'current',
            canNext,
            today,
            config,
            current,
            setSpec,
            shift,
            prev: () => shift(-1),
            next: () => shift(1),
            switchKind,
            setRange,
        }),
        [period, spec, label, progress, canNext, today, config, current, setSpec, shift, switchKind, setRange]
    );
}

export { monthPeriod, rangePeriod };
