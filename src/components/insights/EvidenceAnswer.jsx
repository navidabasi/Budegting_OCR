import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { formatRange } from '../../utils/period';
import { factText } from './factText';

const recordHref = (ref) => (ref ? `/receipts/${ref.txId}${ref.itemId ? `?item=${encodeURIComponent(ref.itemId)}` : ''}` : null);

/**
 * The evidence under an assistant answer: period, currency, basis, item coverage, and the facts the answer cites with the receipts
 * and lines behind them (each one opens the record). Facts from the recorded totals are kept apart from lines read off receipts,
 * which may contain extraction errors. The list collapses.
 */
export default function EvidenceAnswer({ ev, onProposal }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const { money } = useMoney();
    const [open, setOpen] = useState(false);
    if (!ev) return null;
    const { pack, refs = {}, citations = [], uncertain = [], grounded, unsupported = [], proposals = [], state } = ev;
    const fmt = (v) => money(v, pack.currency);
    const period = pack.period?.start ? `${formatRange({ start: pack.period.start, end: pack.period.end }, languageCode)}${pack.period.state === 'current' ? ` (${t('evidence.dayOf', { day: pack.period.day, days: pack.period.days })})` : ''}` : '';
    const cov = pack.coverage && pack.coverage.receipts > 0 ? pack.coverage : null;
    const cited = new Set(citations);
    const shown = pack.facts.filter((f) => (state === 'ok' && cited.size ? cited.has(f.id) : true));
    const isExtracted = (f) => f.extracted || uncertain.includes(f.id);
    const groups = [
        ['recorded', shown.filter((f) => !isExtracted(f))],
        ['extracted', shown.filter(isExtracted)],
    ].filter(([, list]) => list.length > 0);
    const evById = new Map(pack.evidence.map((e) => [e.id, e]));
    const date = (d) => (d ? new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00`)) : '');
    const conv = pack.conversion?.count || 0;

    return (
        <div className="flex w-full flex-col gap-2 rounded-2xl border border-line bg-surface px-3.5 py-3" data-testid="evidence">
            {pack.intent !== 'owed' ? (
                <p className="text-xs font-medium text-ink-muted" data-testid="evidence-meta">
                    {t('evidence.metaLine', { period, currency: pack.currency, basis: t(`evidence.basis.${pack.basis}`) })}
                </p>
            ) : (
                <p className="text-xs font-medium text-ink-muted" data-testid="evidence-meta">
                    {t('evidence.metaLine', { period: t('evidence.basis.all'), currency: pack.currency, basis: t('evidence.basis.full') })}
                </p>
            )}
            {pack.comparison ? <p className="text-xs text-ink-muted">{t(`evidence.cmp.${pack.comparison.basis}`, { days: pack.comparison.elapsedDays })}</p> : null}
            {cov ? (
                <p className={`text-xs font-medium ${cov.share < 50 ? 'text-warn-ink' : 'text-ink-muted'}`} data-testid="evidence-coverage">
                    {t('evidence.coverage', { pct: cov.share, itemised: fmt(cov.itemised), total: fmt(cov.total), unknown: fmt(cov.unknown) })}
                </p>
            ) : null}
            {conv > 0 ? (
                <p className="flex items-start gap-1.5 text-xs font-medium text-warn-ink" data-testid="evidence-unconverted">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {conv === 1 ? t('evidence.notConverted1') : t('evidence.notConverted', { count: conv })}
                </p>
            ) : null}
            {state === 'ok' && !grounded ? (
                <p className="flex items-start gap-1.5 text-xs font-medium text-warn-ink" data-testid="evidence-ungrounded">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {t('evidence.notCited')}
                </p>
            ) : null}
            {unsupported.length > 0 ? (
                <p className="flex items-start gap-1.5 text-xs font-medium text-warn-ink" data-testid="evidence-unsupported">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {t('evidence.unsupported', { list: unsupported.join(', ') })}
                </p>
            ) : null}
            {state === 'offline' ? <p className="text-xs text-ink-muted">{t('evidence.offlineFacts')}</p> : null}
            {state === 'failed' ? <p className="text-xs text-ink-muted">{t('evidence.failedFacts')}</p> : null}

            {shown.length > 0 ? (
                <>
                    <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl text-start text-sm font-semibold text-forest-ink" data-testid="evidence-toggle">
                        {open ? t('evidence.toggleHide') : t('evidence.toggleShow', { count: shown.length })}
                        <ChevronDown size={16} className={open ? 'rotate-180' : ''} aria-hidden="true" />
                    </button>
                    {open ? (
                        <div className="flex flex-col gap-3" data-testid="evidence-list">
                            {groups.map(([key, list]) => (
                                <section key={key} className="flex flex-col gap-2" aria-label={t(`evidence.group.${key}`)}>
                                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{t(`evidence.group.${key}`)}</h3>
                                    <ul className="flex flex-col gap-2.5">
                                        {list.map((f) => (
                                            <li key={f.id} className="flex flex-col gap-1" data-testid="evidence-fact" data-fact={f.id}>
                                                <p className="text-sm leading-snug text-ink">
                                                    <span className="me-1.5 rounded-md bg-tint px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted">{f.id}</span>
                                                    {factText(f, { t, money: fmt, localizeCategory })}
                                                </p>
                                                {(f.refs || []).length > 0 ? (
                                                    <ul className="flex flex-col">
                                                        {f.refs.map((rid) => {
                                                            const e = evById.get(rid);
                                                            const href = recordHref(refs[rid]);
                                                            if (!e || !href) return null;
                                                            return (
                                                                <li key={rid}>
                                                                    <Link to={href} className="flex min-h-[44px] items-center gap-2 rounded-lg ps-2 text-start text-[13px] text-ink-muted" aria-label={t('evidence.openRecord', { name: e.name || e.merchant })} data-testid="evidence-ref">
                                                                        <span className="min-w-0 flex-1 truncate">{[e.merchant, e.name, date(e.date)].filter(Boolean).join(' · ')}</span>
                                                                        {e.uncertain ? <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn-ink">{t('evidence.unclear')}</span> : null}
                                                                        <span className="shrink-0 font-mono text-ink" dir="ltr">{fmt(e.amount)}</span>
                                                                        <ChevronRight size={14} className="shrink-0 text-ink-faint rtl:rotate-180" aria-hidden="true" />
                                                                    </Link>
                                                                </li>
                                                            );
                                                        })}
                                                    </ul>
                                                ) : null}
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ))}
                        </div>
                    ) : null}
                </>
            ) : null}

            {proposals.length > 0 ? (
                <section className="flex flex-col gap-1.5" aria-label={t('evidence.proposals.title')} data-testid="proposals">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{t('evidence.proposals.title')}</h3>
                    {proposals.map((p) => (
                        <button key={p.id} type="button" onClick={() => onProposal(p)} className="flex min-h-[48px] items-center gap-2 rounded-xl border border-forest-ink bg-surface px-3.5 py-2 text-start text-sm font-semibold text-forest-ink" data-testid="proposal">
                            <span className="min-w-0 flex-1">{proposalLabel(p, t)}</span>
                            <ChevronRight size={15} className="shrink-0 rtl:rotate-180" aria-hidden="true" />
                        </button>
                    ))}
                </section>
            ) : null}
        </div>
    );
}

/** "Move Q8, Bar Roma to Fuel" etc. Shared with the history list. */
export function proposalLabel(p, t) {
    if (p.type === 'recategorise') return t('evidence.prop.recategorise', { merchants: [...new Set(p.records.map((r) => r.merchant))].slice(0, 3).join(', '), category: p.category });
    if (p.type === 'mark_duplicate') return t('evidence.prop.mark_duplicate', { merchant: p.remove.merchant });
    if (p.type === 'create_recurring') return t('evidence.prop.create_recurring', { merchant: p.records[0].merchant, frequency: t(`evidence.freq.${p.frequency}`) });
    return t('evidence.prop.prepare_correction', { merchant: p.record.merchant });
}
