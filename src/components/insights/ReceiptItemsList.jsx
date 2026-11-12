import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';

/**
 * Every line of the receipt a receipt_items answer is about, laid out like the printed receipt: name on the left, price on the
 * right joined by a dotted leader, the totals underneath. Drawn from the evidence pack, so the list is complete whatever the
 * answer text says. Lines are read off the receipt and may contain errors; a line still marked for review is flagged.
 * `listed`: the answer already lists the lines (a translation, a subset), so the receipt starts folded.
 */
export default function ReceiptItemsList({ ev, listed = false }) {
    const [open, setOpen] = useState(!listed);
    const { t, languageCode, localizeCategory } = useTranslation();
    const { money } = useMoney();
    const facts = ev?.pack?.facts || [];
    const receipt = facts.find((f) => f.kind === 'receipt');
    const lines = facts.find((f) => f.kind === 'receipt_items');
    if (!receipt || !lines?.items?.length) return null;
    const fmt = (v) => money(v, ev.pack.currency);
    const ref = ev.refs?.[receipt.refs?.[0]];
    const date = receipt.date ? new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${receipt.date}T00:00:00`)) : '';
    const off = Math.abs(receipt.difference || 0) >= 0.01;

    return (
        <section className="flex w-full flex-col rounded-2xl border border-line bg-surface px-3.5 pb-1 pt-3" aria-label={t('evidence.receipt.title', { merchant: receipt.merchant })} data-testid="receipt-items">
            <header className={`flex items-baseline justify-between gap-3 ${open ? 'border-b border-dashed border-line pb-2' : ''}`}>
                <h3 className="min-w-0 truncate text-sm font-semibold text-ink">{receipt.merchant}</h3>
                <p className="shrink-0 text-xs text-ink-muted">{[date, t('evidence.receipt.count', { count: lines.items.length })].filter(Boolean).join(' · ')}</p>
            </header>
            {open ? (
                <>
                    <ul className="flex flex-col py-1.5">
                        {lines.items.map((it) => (
                            <li key={it.n} className="flex items-end gap-2 py-1 text-[13px] leading-snug" data-testid="receipt-line">
                                <span className="min-w-0 text-ink">
                                    {it.quantity ? <span className="me-1 font-mono text-ink-muted" dir="ltr">{`${it.quantity}${it.unit ? ` ${it.unit}` : '×'}`}</span> : null}
                                    {it.name || t('evidence.receipt.unnamed')}
                                    {it.category ? <span className="ms-1.5 text-[11px] text-ink-muted">{localizeCategory(it.category)}</span> : null}
                                    {it.uncertain ? <span className="ms-1.5 rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn-ink">{t('evidence.unclear')}</span> : null}
                                </span>
                                <span className="mb-1 min-w-[12px] flex-1 border-b border-dotted border-ink-faint" aria-hidden="true" />
                                <span className="shrink-0 font-mono text-ink" dir="ltr">{it.amount === null ? '—' : fmt(it.amount)}</span>
                            </li>
                        ))}
                    </ul>
                    <dl className="flex flex-col gap-0.5 border-t border-dashed border-line py-2 text-[13px]">
                        <div className="flex justify-between gap-3">
                            <dt className="font-semibold text-ink">{t('evidence.receipt.total')}</dt>
                            <dd className="font-mono font-semibold text-ink" dir="ltr">{fmt(receipt.total)}</dd>
                        </div>
                        {receipt.yourShare !== undefined ? (
                            <div className="flex justify-between gap-3 text-ink-muted">
                                <dt>{t('evidence.receipt.yourShare')}</dt>
                                <dd className="font-mono" dir="ltr">{fmt(receipt.yourShare)}</dd>
                            </div>
                        ) : null}
                        {off ? (
                            <div className="flex justify-between gap-3 text-warn-ink" data-testid="receipt-difference">
                                <dt>{t('evidence.receipt.linesSum')}</dt>
                                <dd className="font-mono" dir="ltr">{fmt(receipt.itemsSum)}</dd>
                            </div>
                        ) : null}
                    </dl>
                    <p className="text-[11px] text-ink-muted">{t('evidence.receipt.readNote')}</p>
                </>
            ) : null}
            <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-[44px] items-center gap-1.5 text-start text-sm font-semibold text-forest-ink" data-testid="receipt-toggle">
                    {open ? t('evidence.receipt.hide') : t('evidence.receipt.show', { count: lines.items.length })}
                    <ChevronDown size={16} className={open ? 'rotate-180' : ''} aria-hidden="true" />
                </button>
                {ref?.txId ? (
                    <Link to={`/receipts/${ref.txId}`} className="flex min-h-[44px] shrink-0 items-center gap-1 text-sm font-semibold text-forest-ink" data-testid="receipt-open">
                        {t('evidence.receipt.open')}
                        <ChevronRight size={16} className="rtl:rotate-180" aria-hidden="true" />
                    </Link>
                ) : null}
            </div>
        </section>
    );
}
