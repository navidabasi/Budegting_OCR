import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CalendarDays, ChevronRight, Coins, EyeOff, Repeat, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { useAppStore } from '../../store/appStore';
import { patternHref, patternText } from '../../services/patternText';

const ICON = {
    weekend_heavy: CalendarDays,
    small_purchases: Coins,
    first_week_spike: CalendarClock,
    merchant_cadence: Repeat,
    category_streak: TrendingUp,
    payday_effect: Wallet,
};

/** The two (or more) figures a pattern compares, as small bars: the shape of the habit at a glance. null when there is nothing to compare. */
function barsOf(p, t) {
    const q = p.params || {};
    if (p.kind === 'weekend_heavy') return [[t('pattern.bar.weekday'), q.weekdayPerDay], [t('pattern.bar.weekend'), q.weekendPerDay]];
    if (p.kind === 'small_purchases') return [[t('pattern.bar.usual'), q.baselineTotal], [t('pattern.bar.now'), q.total]];
    if (p.kind === 'first_week_spike') return [[t('pattern.bar.firstWeek'), q.perDayFirstWeek], [t('pattern.bar.rest'), q.perDayRest]];
    if (p.kind === 'payday_effect') return [[t('pattern.bar.afterPayday'), q.perDayAfter], [t('pattern.bar.otherDays'), q.perDayOther]];
    if (p.kind === 'category_streak') return (q.amounts || []).map((v, i, all) => [t('pattern.bar.period', { n: i + 1, of: all.length }), v]);
    return null;
}

/** Decorative: the card text states every figure. The highlighted bar is the latest (a trend) or the larger one (a comparison). */
function Bars({ bars, money, highlightLast }) {
    const values = bars.map(([, v]) => v);
    const max = Math.max(...values, 0.01);
    const hot = highlightLast ? bars.length - 1 : values.indexOf(Math.max(...values));
    return (
        <ul className="flex h-10 items-end gap-1" aria-hidden="true">
            {bars.map(([label, v], i) => (
                <li key={label} className="flex h-full w-3 items-end" title={`${label}: ${money(v)}`}>
                    <span className={`block w-full rounded-sm ${i === hot ? 'bg-forest-ink' : 'bg-line-strong'}`} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
                </li>
            ))}
        </ul>
    );
}

/**
 * "Your patterns" (assistant v2, B-T3): habits the app found in the owner's own records (services/patternInsights.js), computed on
 * the device and shown offline too. Each card states its figures, shows their shape as small bars, links to the transactions
 * behind it and can be hidden for 60 days (the same synced store as Ways to save, with Undo).
 */
export default function YourPatterns({ patterns = [], hiddenCount = 0, onDismiss, onRestore }) {
    const { t, localizeCategory, languageCode } = useTranslation();
    const { money } = useMoney();
    const showToast = useAppStore((s) => s.showToast);
    const [busy, setBusy] = useState(null);
    const number = (v) => new Intl.NumberFormat(`${languageCode}-u-nu-latn`, { maximumFractionDigits: 1 }).format(v);
    if (patterns.length === 0 && hiddenCount === 0) return null;

    const dismiss = async (p) => {
        setBusy(p.key);
        try {
            await onDismiss(p.key);
            showToast(t('insights.patterns.dismissed'), 'success', { action: { label: t('insights.save.undo'), onClick: () => onRestore([p.key]) } });
        } catch {
            showToast(t('insights.save.failed'), 'error');
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className="flex flex-col gap-2.5" aria-labelledby="patterns-title" data-testid="your-patterns">
            <div className="flex flex-col gap-0.5">
                <h2 id="patterns-title" className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">{t('insights.patterns.title')}</h2>
                <p className="text-[13px] text-ink-muted">{t('insights.patterns.subtitle')}</p>
            </div>
            {patterns.length > 0 ? (
                <ul className="flex flex-col divide-y divide-line rounded-[20px] bg-surface shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line">
                    {patterns.map((p) => {
                        const text = patternText(p, { t, money, localizeCategory, number });
                        const Icon = p.kind === 'category_streak' && p.params?.direction === 'down' ? TrendingDown : ICON[p.kind] || Repeat;
                        const bars = barsOf(p, t);
                        const href = patternHref(p);
                        return (
                            <li key={p.id} className="flex flex-col gap-2 px-4 py-3.5" data-testid="pattern" data-kind={p.kind}>
                                <div className="flex items-start gap-3">
                                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${p.severity === 'watch' ? 'bg-warn-soft text-warn' : 'bg-tint text-ink-muted'}`}>
                                        <Icon size={17} aria-hidden="true" className={p.kind === 'category_streak' ? 'rtl:-scale-x-100' : ''} />
                                    </span>
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <h3 className="text-[15px] font-semibold leading-snug text-ink" data-testid="pattern-title">{text.title}</h3>
                                        <p className="text-[13px] leading-relaxed text-ink-muted" data-testid="pattern-body">{text.body}</p>
                                    </div>
                                    {bars ? <Bars bars={bars} money={money} highlightLast={p.kind === 'category_streak' || p.kind === 'small_purchases'} /> : null}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 ps-12">
                                    {href ? (
                                        <Link to={href} className="flex min-h-[44px] items-center gap-1 rounded-xl text-[13px] font-semibold text-forest-ink" data-testid="pattern-open">
                                            {t('insights.patterns.open')}
                                            <ChevronRight size={14} aria-hidden="true" className="rtl:rotate-180" />
                                        </Link>
                                    ) : null}
                                    <button type="button" onClick={() => dismiss(p)} disabled={busy === p.key} className="ms-auto flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold text-ink-muted disabled:opacity-50" data-testid="pattern-hide">
                                        <EyeOff size={14} aria-hidden="true" />
                                        {t('insights.patterns.hide')}
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
            {hiddenCount > 0 ? (
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-muted" data-testid="patterns-hidden">
                    {t('insights.patterns.hidden', { count: hiddenCount })}
                    <button type="button" onClick={() => onRestore()} className="min-h-[44px] font-semibold text-forest-ink">{t('insights.save.restore')}</button>
                </p>
            ) : null}
        </section>
    );
}
