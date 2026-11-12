import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronRight, Minus } from 'lucide-react';
import { Amount } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { useAppStore } from '../../store/appStore';
import { categoryVisual } from '../../utils/categoryVisual';
import { categoryColor } from '../../utils/categoryColors';

/**
 * "Where your money went": the five biggest categories as bars (share of the period's spending) with the change against the
 * previous period, like for like. The whole block opens the Breakdown for the same period.
 */
export default function WhereMoneyWent({ view, periodSpec }) {
    const { t, localizeCategory, isRtl } = useTranslation();
    const { money } = useMoney();
    const dark = useAppStore((s) => s.darkMode);
    if (!view || view.rows.length === 0) return null;
    const max = Math.max(...view.rows.map((r) => r.amount));
    const href = periodSpec ? `/breakdown?m=${encodeURIComponent(periodSpec)}` : '/breakdown';
    return (
        <section className="flex flex-col gap-2" aria-labelledby="where-title" data-testid="where">
            <div className="flex items-end justify-between gap-2">
                <h2 id="where-title" className="text-xs font-semibold uppercase tracking-[.06em] text-ink-muted">{t('insights.where.title')}</h2>
            </div>
            <Link to={href} className="flex flex-col rounded-[20px] bg-surface px-4 pb-1 pt-2 shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line" data-testid="where-link">
                <ul className="flex flex-col">
                    {view.rows.map((r) => {
                        const { Icon, bg, fg } = categoryVisual(r.category);
                        const change = r.delta === null ? null : Math.abs(r.delta) < 1 ? 'same' : r.delta > 0 ? 'up' : 'down';
                        const changeText = change === null ? '' : change === 'same' ? t('insights.where.same') : r.previous === 0 ? t('insights.where.new') : t(`insights.where.${change}`, { amount: money(Math.abs(r.delta)) });
                        return (
                            <li key={r.category} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0" data-testid="where-row">
                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${bg} ${fg}`}>
                                    <Icon size={17} aria-hidden="true" />
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                                    <span className="flex items-baseline gap-2">
                                        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{localizeCategory(r.category)}</span>
                                        <Amount value={r.amount} className="shrink-0 text-[15px] font-medium text-ink" />
                                    </span>
                                    <span className="h-1.5 w-full overflow-hidden rounded-full bg-tint" aria-hidden="true">
                                        <span className="block h-full rounded-full" style={{ width: `${Math.max(3, (r.amount / max) * 100)}%`, backgroundColor: categoryColor(r.category, dark) }} />
                                    </span>
                                    <span className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                                        <span>{t('insights.where.share', { pct: r.pct })}</span>
                                        {change ? (
                                            <span className={`flex min-w-0 items-center gap-1 ${change === 'up' ? 'text-warn-ink' : change === 'down' ? 'text-income' : ''}`}>
                                                {change === 'up' ? <ArrowUp size={12} className="shrink-0" aria-hidden="true" /> : change === 'down' ? <ArrowDown size={12} className="shrink-0" aria-hidden="true" /> : <Minus size={12} className="shrink-0" aria-hidden="true" />}
                                                <span className="truncate">{changeText}</span>
                                            </span>
                                        ) : null}
                                    </span>
                                </span>
                            </li>
                        );
                    })}
                </ul>
                <span className="flex min-h-[44px] items-center justify-between gap-2 border-t border-line text-sm font-semibold text-forest-ink">
                    {t('insights.where.open')}
                    <ChevronRight size={16} className={isRtl ? 'rotate-180' : ''} aria-hidden="true" />
                </span>
            </Link>
        </section>
    );
}
