import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronRight, Eye } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

function List({ id, title, items, Icon, tone, testId }) {
    const { isRtl } = useTranslation();
    if (items.length === 0) return null;
    const row = 'flex min-h-[52px] items-start gap-3 py-2.5';
    const body = (it) => (
        <>
            <Icon size={18} className={`mt-0.5 shrink-0 ${tone}`} aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-medium leading-snug text-ink">{it.text}</span>
                {it.detail ? <span className="text-[13px] leading-snug text-ink-muted">{it.detail}</span> : null}
            </span>
            {it.href ? <ChevronRight size={16} className={`mt-1 shrink-0 text-ink-faint ${isRtl ? 'rotate-180' : ''}`} aria-hidden="true" /> : null}
        </>
    );
    return (
        <section className="flex min-w-0 flex-col gap-2" aria-labelledby={id} data-testid={testId}>
            <h2 id={id} className="text-xs font-semibold uppercase tracking-[.06em] text-ink-muted">{title}</h2>
            <ul className="rounded-[20px] bg-surface px-4 py-0.5 shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line">
                {items.map((it, i) => (
                    <li key={`${i}-${it.text}`} className="border-b border-line last:border-0">
                        {it.href ? <Link to={it.href} className={row}>{body(it)}</Link> : <div className={row}>{body(it)}</div>}
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** Wins and watch-outs as two compact lists with their own icon (pass 3, A3). items: [{ text, detail?, href? }]. */
export default function WinsWatchouts({ wins = [], watchouts = [] }) {
    const { t } = useTranslation();
    if (wins.length === 0 && watchouts.length === 0) return null;
    return (
        <div className="flex flex-col gap-3">
            <List id="wins-title" title={t('insights.wins.title')} items={wins} Icon={CheckCircle2} tone="text-income" testId="wins" />
            <List id="watch-title" title={t('insights.watch.title')} items={watchouts} Icon={Eye} tone="text-warn" testId="watchouts" />
        </div>
    );
}
