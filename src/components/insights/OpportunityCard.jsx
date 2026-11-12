import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, ChevronRight, Home, Landmark, Receipt, Repeat, SlidersHorizontal, Sparkles, Store, Tag, Target, TrendingUp } from 'lucide-react';
import { Amount } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { formatRange } from '../../utils/period';
import { opportunityText } from '../../services/opportunityText';

const ICON = {
    category_above_baseline: [TrendingUp, 'bg-warn-soft text-warn'],
    merchant_frequency: [Receipt, 'bg-warn-soft text-warn'],
    subscription_review: [Repeat, 'bg-savings-soft text-savings'],
    price_creep: [ArrowUpRight, 'bg-savings-soft text-savings'],
    cheaper_store: [Store, 'bg-mint text-forest-ink'],
    budget_gap: [SlidersHorizontal, 'bg-mint text-forest-ink'],
    debt_cost: [Landmark, 'bg-tint text-ink-muted'],
    goal_boost: [Target, 'bg-savings-soft text-savings'],
    uncategorised_blind_spot: [Tag, 'bg-tint text-ink-muted'],
    fixed_cost: [Home, 'bg-tint text-ink-muted'],
};
const DOT = { high: 'bg-income', medium: 'bg-warn', low: 'bg-ink-faint' };

/**
 * One way to save, set like a slip of the month's receipt: what it is, the saving per month and per year on dotted leaders, one
 * sentence of explanation (the AI's while its figures still match, else the app's own), a "Why?" expander with how it was worked
 * out and the receipts behind it, and below the tear line the one action plus "Not useful".
 *   ai: { explanation, howTo } | null     records: the transactions behind it (largest first)     action: { href } | { onClick }
 */
export default function OpportunityCard({ opportunity: o, ai, records = [], action, onDismiss, busy = false }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const { money, currency } = useMoney();
    const [open, setOpen] = useState(false);
    const panelId = useId();
    const date = (d) => (d ? new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T00:00:00`)) : '');
    const shortDate = (d) => (d ? new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short' }).format(new Date(`${String(d).slice(0, 10)}T00:00:00`)) : '');
    const text = opportunityText(o, { t, money, localizeCategory, date });
    const [Icon, tone] = ICON[o.kind] || [Sparkles, 'bg-tint text-ink-muted'];
    const saves = o.monthlySaving > 0;
    const primary = 'flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-forest px-3.5 py-2 text-center text-sm font-semibold text-white disabled:opacity-50';

    return (
        <article id={`opp-${o.key}`} className="flex scroll-mt-24 flex-col rounded-[20px] bg-surface shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line" data-testid="opportunity" data-kind={o.kind}>
            <div className="flex flex-col gap-3 px-4 pb-3 pt-4">
                <header className="flex items-start gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                        <Icon size={17} aria-hidden="true" />
                    </span>
                    <h3 className="min-w-0 flex-1 pt-0.5 text-[16px] font-semibold leading-snug text-ink">{text.title}</h3>
                </header>
                <div className="flex flex-col gap-1.5">
                    <p className="text-sm leading-relaxed text-ink" data-testid="opportunity-explanation">{ai?.explanation || text.body}</p>
                    {ai?.howTo ? <p className="text-sm leading-relaxed text-ink-muted">{ai.howTo}</p> : null}
                    {ai ? (
                        <span className="flex items-center gap-1 text-[11px] text-ink-faint" data-testid="opportunity-ai">
                            <Sparkles size={11} aria-hidden="true" />
                            {t('insights.save.aiNote')}
                        </span>
                    ) : null}
                </div>
                {saves ? (
                    <dl className="flex flex-col gap-1 rounded-[14px] bg-tint px-3.5 py-2.5 text-sm text-ink">
                        <div className="flex items-baseline">
                            <dt className="shrink-0 font-medium">{t('opp.saving')}</dt>
                            <span className="lead" aria-hidden="true" />
                            <dd className="shrink-0 font-semibold text-forest-ink" data-testid="opportunity-monthly">
                                <span className="sr-only">{t('opp.perMonth', { amount: money(o.monthlySaving) })}</span>
                                <span aria-hidden="true"><Amount value={o.monthlySaving} currency={currency} symbol symbolClassName="!text-forest-ink" /></span>
                            </dd>
                        </div>
                        <div className="flex items-baseline text-ink-muted">
                            <dt className="shrink-0">{t('opp.perYear', { amount: '' }).trim()}</dt>
                            <span className="lead" aria-hidden="true" />
                            <dd className="shrink-0"><Amount value={o.yearlySaving} currency={currency} symbol /></dd>
                        </div>
                    </dl>
                ) : (
                    <span className="w-fit rounded-lg bg-tint px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-ink-muted">{text.badge}</span>
                )}
                <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={panelId} className="-my-1 flex min-h-[44px] items-center justify-between gap-2 text-start text-sm font-semibold text-forest-ink" data-testid="opportunity-why">
                    <span className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${DOT[o.level]}`} aria-hidden="true" />
                        {open ? t('insights.save.hideWhy') : t('insights.save.why')}
                    </span>
                    <ChevronDown size={16} className={`shrink-0 transition-transform duration-inline ease-out ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {open ? (
                    <div id={panelId} className="flex flex-col gap-2.5 border-t border-line pt-3" data-testid="opportunity-details">
                        <p className="text-[13px] leading-relaxed text-ink-muted">{text.why}</p>
                        {ai ? <p className="text-[13px] leading-relaxed text-ink-muted">{text.body}</p> : null}
                        {text.examples.length ? (
                            <ul className="flex flex-col gap-1 text-[13px] text-ink">
                                {text.examples.map((e) => <li key={e} className="font-mono text-[12px]">{e}</li>)}
                            </ul>
                        ) : null}
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-ink-muted">
                            <span>{formatRange(o.scope, languageCode)}</span>
                            <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${DOT[o.level]}`} aria-hidden="true" />{t(`opp.confidence.${o.level}`)}</span>
                        </p>
                        {records.length ? (
                            <section className="flex flex-col" aria-label={t('insights.save.evidence')}>
                                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{t('insights.save.evidence')}</h4>
                                <ul className="flex flex-col">
                                    {records.map((r) => (
                                        <li key={r.id} className="border-b border-line last:border-0">
                                            <Link to={`/receipts/${r.id}`} className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink" aria-label={t('evidence.openRecord', { name: r.merchant })} data-testid="opportunity-record">
                                                <span className="min-w-0 flex-1 truncate">{r.merchant}</span>
                                                <span className="shrink-0 text-xs text-ink-muted">{shortDate(r.date)}</span>
                                                <Amount value={r.amount} className="w-[72px] shrink-0 text-end text-ink" />
                                                <ChevronRight size={14} className="shrink-0 text-ink-faint rtl:rotate-180" aria-hidden="true" />
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ) : null}
                    </div>
                ) : null}
            </div>
            <div className="flex items-center gap-2 border-t-2 border-dashed border-line px-4 py-3">
                {action?.href ? (
                    <Link to={action.href} className={primary} data-testid="opportunity-action">{text.action}</Link>
                ) : (
                    <button type="button" onClick={action?.onClick} disabled={busy || !action?.onClick} className={primary} data-testid="opportunity-action">{text.action}</button>
                )}
                <button type="button" onClick={onDismiss} disabled={busy} className="flex min-h-[44px] shrink-0 items-center rounded-xl px-3 text-sm font-semibold text-ink-muted disabled:opacity-50" data-testid="opportunity-dismiss">
                    {t('insights.save.notUseful')}
                </button>
            </div>
        </article>
    );
}
