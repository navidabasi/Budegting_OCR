import { Loader2, RefreshCw, Sparkles, WifiOff } from 'lucide-react';
import { Amount } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';

const when = (iso, lang) => {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(`${lang}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
};

/** The sentence the app writes itself when there is no AI verdict (offline, not set up, rejected by the number check). */
export function ownVerdict(figures, { t, money }) {
    if (!figures) return '';
    const running = figures.basis === 'elapsed';
    const spent = money(figures.spent);
    if (figures.change === null || Math.abs(figures.change) < 1) return t(running ? 'insights.verdict.firstRunning' : 'insights.verdict.firstDone', { spent });
    const more = figures.change > 0;
    return t(`insights.verdict.${more ? 'more' : 'less'}${running ? 'Running' : 'Done'}`, { spent, delta: money(Math.abs(figures.change)) });
}

/**
 * Verdict strip (pass 3, A3): one sentence and three figures the app computed (spent against the same point of the last period,
 * saved, safe to spend per day). The sentence is the AI's when there is a current one, otherwise the app's own.
 * narrative: { status, data, stale }; status: idle | loading | ready | offline | notConfigured | rateLimit | error.
 */
export default function VerdictStrip({ figures, narrative, onRetry, onUpdate, canUpdate = true }) {
    const { t, languageCode } = useTranslation();
    const { money, currency } = useMoney();
    if (!figures) return null;
    const { status, data, stale } = narrative || {};
    const running = figures.basis === 'elapsed';
    const headline = data?.verdict || ownVerdict(figures, { t, money });
    const change = figures.change;
    const up = change !== null && change >= 1;
    const down = change !== null && change <= -1;
    const savedPct = figures.income > 0 ? Math.round((figures.saved / figures.income) * 100) : null;
    const label = 'text-[11px] font-semibold uppercase tracking-[.06em] opacity-75';
    const sub = 'text-[11px] leading-tight opacity-80';
    const big = 'text-[21px] font-semibold leading-none tracking-tight';
    const problem = status === 'offline' ? t('insights.ai.offline') : status === 'notConfigured' || status === 'rateLimit' || status === 'error' ? (status === 'rateLimit' ? t('insights.rateLimit') : t('insights.ai.unavailable')) : null;

    return (
        <section className="flex flex-col gap-3 rounded-3xl bg-forest px-5 pb-4 pt-5 text-white" aria-label={t('insights.verdict.label')} data-testid="verdict">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold uppercase tracking-[.06em] opacity-80">{t('insights.verdict.label')}</span>
                <span className="shrink-0 text-xs opacity-80">{running ? t('insights.verdict.daysLeft', { count: figures.daysLeft }) : t('insights.verdict.closed')}</span>
            </div>
            <div className="flex flex-col gap-1.5">
                <h2 className="font-display text-[21px] font-bold leading-snug" data-testid="verdict-headline">{headline}</h2>
                {data?.summary ? <p className="text-sm leading-relaxed opacity-90">{data.summary}</p> : null}
            </div>
            <dl className="grid grid-cols-3 gap-3 border-t border-white/20 pt-3">
                <div className="flex min-w-0 flex-col gap-1">
                    <dt className={label}>{t('insights.verdict.spent')}</dt>
                    <dd className="flex min-w-0 flex-col gap-1">
                        <Amount value={figures.spent} className={big} />
                        <span className={`${sub} ${up ? 'text-[#FFD88A] opacity-100' : ''}`} data-testid="verdict-change">
                            {change === null ? t('insights.verdict.noCompare') : t(running ? 'insights.verdict.vsElapsed' : 'insights.verdict.vsCompleted', { delta: `${up ? '+' : down ? '−' : ''}${money(Math.abs(change))}` })}
                        </span>
                    </dd>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                    <dt className={label}>{t('insights.verdict.saved')}</dt>
                    <dd className="flex min-w-0 flex-col gap-1">
                        <Amount value={figures.saved} className={big} />
                        <span className={sub}>{savedPct === null ? t('insights.verdict.noIncome') : t('insights.verdict.ofIncome', { pct: savedPct })}</span>
                    </dd>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                    <dt className={label}>{t('insights.verdict.safe')}</dt>
                    <dd className="flex min-w-0 flex-col gap-1">
                        {figures.safePerDay === null ? <span className={`${big} opacity-60`} aria-hidden="true">–</span> : <Amount value={figures.safePerDay} className={big} />}
                        <span className={sub}>{figures.safePerDay !== null ? `${currency} ${t('insights.verdict.perDay')}` : running ? t('insights.verdict.needsBudget') : t('insights.verdict.closed')}</span>
                    </dd>
                </div>
            </dl>
            {stale ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/10 px-3 py-2" data-testid="narrative-stale">
                    <span className="min-w-0 flex-1 text-xs font-medium">{t('evidence.stale')}</span>
                    {onUpdate ? (
                        <button type="button" onClick={onUpdate} disabled={!canUpdate} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white/15 px-3.5 text-sm font-semibold disabled:opacity-50">
                            <RefreshCw size={15} aria-hidden="true" />
                            {t('evidence.updateSummary')}
                        </button>
                    ) : null}
                </div>
            ) : null}
            {status === 'loading' || status === 'idle' ? (
                <span className="flex items-center gap-1.5 text-xs opacity-80" role="status" data-testid="narrative-loading">
                    <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                    {t('insights.ai.writing')}
                </span>
            ) : problem ? (
                <div className="flex flex-wrap items-center justify-between gap-2" data-testid={`narrative-${status}`}>
                    <span className="flex min-w-0 flex-1 items-start gap-1.5 text-xs opacity-85">
                        {status === 'offline' ? <WifiOff size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> : null}
                        {problem}
                    </span>
                    {status !== 'notConfigured' && onRetry ? (
                        <button type="button" onClick={onRetry} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white/15 px-3.5 text-sm font-semibold">
                            <RefreshCw size={15} aria-hidden="true" />
                            {status === 'offline' ? t('insights.tryAgain') : t('insights.retry')}
                        </button>
                    ) : null}
                </div>
            ) : data?.generatedAt ? (
                <span className="flex items-center gap-1.5 text-[11px] opacity-65">
                    <Sparkles size={12} aria-hidden="true" />
                    {t('insights.madeFrom', { model: data.model || '', time: when(data.generatedAt, languageCode) }).replace(/ · +·/g, ' ·').replace(/ · $/, '')}
                </span>
            ) : null}
        </section>
    );
}
