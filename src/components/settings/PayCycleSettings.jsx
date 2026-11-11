import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import Button from '../common/Button';
import SettingsCard from '../common/SettingsCard';
import { Sheet } from '../ui';
import { usePayCycleConfig } from '../../hooks/usePayCycle';
import { useTransactions } from '../../data/hooks';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';
import { addMonths } from '../../utils/monthMath';
import { currentCycleId, cycleRange, isValidTimezone, previewConfigChange, ruleFor, suggestSalaryStart, validateOverride, withOverride, withRule } from '../../utils/payCycle';
import { formatRange } from '../../utils/period';

const input = 'h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

/** Settings > Pay cycle: payday, weekend rule, timezone (changes are effective from a chosen cycle, history is previewed) and per-cycle start dates. */
export default function PayCycleSettings() {
    const { t, languageCode } = useTranslation();
    const showToast = useAppStore((s) => s.showToast);
    const { config, save } = usePayCycleConfig();
    const { transactions } = useTransactions();
    const cur = currentCycleId(config);
    const rule = ruleFor(cur, config);
    const [payday, setPayday] = useState(String(rule.payday));
    const [weekend, setWeekend] = useState(rule.weekendRule === 'previous');
    const [tz, setTz] = useState(config.timezone);
    const [from, setFrom] = useState('next');
    const [preview, setPreview] = useState(null); // { next, moved }
    const [dates, setDates] = useState({});
    const zones = useMemo(() => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Europe/Rome', 'UTC']), []);
    const days = parseInt(payday, 10);
    const valid = days >= 1 && days <= 31 && isValidTimezone(tz);

    const build = () => {
        const fromId = from === 'all' ? '0000-01' : from === 'current' ? cur : addMonths(cur, 1);
        const base = { ...withRule(config, { payday: days, weekendRule: weekend ? 'previous' : 'none', from: fromId }), timezone: tz };
        return base;
    };
    const apply = async (next) => {
        await save(next);
        setPreview(null);
        showToast(t('paycycle.saved'), 'success');
    };
    const onSave = () => {
        if (!valid) return;
        const next = build();
        const moved = from === 'all' ? previewConfigChange(transactions, config, next) : [];
        if (from === 'all') setPreview({ next, moved });
        else apply(next);
    };

    const cycles = [0, -1, -2, -3].map((i) => addMonths(cur, i));
    const suggestion = suggestSalaryStart(transactions, cur, config);
    const setOverride = async (id, start) => {
        try {
            await save(withOverride(config, id, start));
            showToast(t('paycycle.saved'), 'success');
        } catch {
            showToast(t('paycycle.badStart'), 'error');
        }
    };

    return (
        <SettingsCard icon={CalendarRange} title={t('paycycle.title')}>
            <div className="space-y-4" data-testid="paycycle-settings">
                <p className="text-sm text-gray-600 dark:text-gray-400">{config.configured ? t('paycycle.intro') : t('paycycle.introUnset')}</p>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('paycycle.payday')}
                    <input className={`${input} mt-1`} inputMode="numeric" value={payday} onChange={(e) => setPayday(e.target.value.replace(/\D/g, '').slice(0, 2))} />
                </label>
                <label className="flex min-h-[44px] items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" className="h-5 w-5" checked={weekend} onChange={(e) => setWeekend(e.target.checked)} />
                    {t('paycycle.weekend')}
                </label>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('paycycle.timezone')}
                    <input className={`${input} mt-1`} list="tz-list" value={tz} onChange={(e) => setTz(e.target.value)} />
                    <datalist id="tz-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
                </label>
                <fieldset className="space-y-1">
                    <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('paycycle.effective')}</legend>
                    {[['next', t('paycycle.fromNext')], ['current', t('paycycle.fromCurrent')], ['all', t('paycycle.fromAll')]].map(([v, label]) => (
                        <label key={v} className="flex min-h-[44px] items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                            <input type="radio" name="pc-from" className="h-5 w-5" checked={from === v} onChange={() => setFrom(v)} />
                            {label}
                        </label>
                    ))}
                </fieldset>
                <Button variant="primary" disabled={!valid} onClick={onSave} className="w-full">{t('paycycle.save')}</Button>

                <div className="space-y-2 border-t border-gray-100 pt-4 dark:border-gray-700">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white">{t('paycycle.starts')}</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('paycycle.startsHint')}</p>
                    {suggestion ? (
                        <Button variant="secondary" className="w-full" onClick={() => setOverride(cur, suggestion.date)} disabled={!validateOverride(cur, suggestion.date, config).ok || cycleRange(cur, config).start === suggestion.date}>
                            {t('paycycle.suggest', { date: suggestion.date })}
                        </Button>
                    ) : null}
                    {cycles.map((id) => {
                        const r = cycleRange(id, config);
                        const has = config.overrides.some((o) => o.cycle === id);
                        const value = dates[id] ?? r.start;
                        return (
                            <div key={id} className="flex flex-wrap items-center gap-2" data-testid="cycle-row">
                                <span className="min-w-0 flex-1 text-sm text-gray-800 dark:text-gray-200">{formatRange(r, languageCode)}{has ? ` · ${t('paycycle.adjusted')}` : ''}</span>
                                <input type="date" aria-label={t('paycycle.starts')} className="h-11 rounded-lg border border-gray-300 bg-white px-2 text-base dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" value={value} onChange={(e) => setDates((d) => ({ ...d, [id]: e.target.value }))} />
                                <Button variant="secondary" disabled={value === r.start} onClick={() => setOverride(id, value)}>{t('paycycle.set')}</Button>
                                {has ? <Button variant="secondary" onClick={() => setOverride(id, null)}>{t('paycycle.reset')}</Button> : null}
                            </div>
                        );
                    })}
                </div>
            </div>
            <Sheet open={!!preview} onClose={() => setPreview(null)} label={t('paycycle.previewTitle')}>
                <div className="flex flex-col gap-3 px-5 pb-2">
                    <h2 className="font-display text-lg font-bold text-ink">{t('paycycle.previewTitle')}</h2>
                    <p className="text-sm text-ink-muted">{preview?.moved.length ? t('paycycle.previewBody', { count: preview.moved.length }) : t('paycycle.previewNone')}</p>
                    <button type="button" onClick={() => apply(preview.next)} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white">{t('paycycle.apply')}</button>
                    <button type="button" onClick={() => setPreview(null)} className="h-12 rounded-[18px] text-sm font-semibold text-ink-muted">{t('common.actions.cancel')}</button>
                </div>
            </Sheet>
        </SettingsCard>
    );
}
