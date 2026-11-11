import { RefreshCw, WifiOff } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

const when = (iso, lang) => {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(`${lang}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
};

/** AI narrative card (docs/design/Insights.dc.html). status: loading | ready | offline | notConfigured | rateLimit | error */
export default function NarrativeCard({ status, data, onRetry, stale = false, onUpdate, canUpdate = true }) {
    const { t, languageCode } = useTranslation();
    const card = 'flex flex-col gap-2 rounded-[20px] bg-ink p-4 text-ground dark:bg-surface dark:text-ink dark:ring-1 dark:ring-line';
    if (status === 'idle' || (status === 'loading' && !data)) {
        return (
            <section className={card} aria-busy="true" aria-label={t('insights.narrative')} data-testid="narrative-loading">
                <div className="h-5 w-4/5 animate-pulse rounded bg-white/20" />
                <div className="h-3.5 w-full animate-pulse rounded bg-white/15" />
                <div className="h-3.5 w-11/12 animate-pulse rounded bg-white/15" />
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/15" />
                <span className="text-[11px] opacity-60">{t('insights.generating')}</span>
            </section>
        );
    }
    if (!data && status !== 'ready') {
        const msg = status === 'offline' ? t('insights.connect') : status === 'notConfigured' ? t('insights.notConfigured') : status === 'rateLimit' ? t('insights.rateLimit') : t('insights.failed');
        return (
            <section className={card} data-testid={`narrative-${status}`} aria-label={t('insights.narrative')}>
                <span className="flex items-center gap-2 text-[15px] font-semibold">
                    {status === 'offline' ? <WifiOff size={18} aria-hidden="true" /> : null}
                    {msg}
                </span>
                {status === 'notConfigured' ? <span className="text-[13px] opacity-80">{t('insights.notConfiguredHint')}</span> : null}
                {status === 'error' || status === 'rateLimit' || status === 'offline' ? (
                    <button type="button" onClick={onRetry} className="mt-1 flex h-11 w-fit items-center gap-1.5 rounded-xl bg-white/15 px-3.5 text-sm font-semibold">
                        <RefreshCw size={15} aria-hidden="true" />
                        {status === 'offline' ? t('insights.tryAgain') : t('insights.retry')}
                    </button>
                ) : null}
            </section>
        );
    }
    const list = (items) => (items?.length ? (
        <ul className="flex list-disc flex-col gap-1 ps-5 text-[13px] leading-snug opacity-90">
            {items.map((x) => <li key={x}>{x}</li>)}
        </ul>
    ) : null);
    return (
        <section className={card} aria-label={t('insights.narrative')} data-testid="narrative">
            <h2 className="font-display text-[19px] font-bold leading-tight">{data.headline}</h2>
            <p className="text-sm leading-relaxed opacity-90">{data.summary}</p>
            {list(data.wins)}
            {list(data.concerns)}
            {list(data.actions)}
            {stale ? (
                <div className="flex flex-col gap-1.5 rounded-xl bg-white/10 px-3 py-2" data-testid="narrative-stale">
                    <span className="text-xs font-semibold">{t('evidence.stale')}</span>
                    {onUpdate ? (
                        <button type="button" onClick={onUpdate} disabled={!canUpdate} className="flex h-11 w-fit items-center gap-1.5 rounded-xl bg-white/15 px-3.5 text-sm font-semibold disabled:opacity-50">
                            <RefreshCw size={15} aria-hidden="true" />
                            {t('evidence.updateSummary')}
                        </button>
                    ) : null}
                </div>
            ) : null}
            {status !== 'ready' && status !== 'loading' ? <span className="text-xs opacity-80">{status === 'offline' ? t('insights.connect') : status === 'rateLimit' ? t('insights.rateLimit') : t('insights.failed')}</span> : null}
            <span className="text-[11px] opacity-60">{t('insights.madeFrom', { model: data.model || '', time: when(data.generatedAt, languageCode) }).replace(/ · +·/g, ' ·').replace(/ · $/, '')}</span>
        </section>
    );
}
