import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Sheet } from '../ui';
import { proposalLabel } from './EvidenceAnswer';
import { applyProposal, proposalHref } from '../../services/aiActions';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { useAppStore } from '../../store/appStore';
import { notifyDataChanged } from '../../data/queryClient';

const MAX_ROWS = 6;

/**
 * Preview of a bookkeeping proposal. Nothing changes until "Apply change"; a prepared correction only opens the record. After
 * applying, the change is in the history (Undo there). Double taps are ignored (synchronous guard).
 */
export default function ProposalSheet({ proposal, onClose, onApplied }) {
    const { t, localizeCategory } = useTranslation();
    const { money } = useMoney();
    const userId = useAppStore((s) => s.currentUser?.userId);
    const showToast = useAppStore((s) => s.showToast);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const [guard] = useState({ busy: false });
    if (!proposal) return <Sheet open={false} onClose={onClose} label="" />;
    const href = proposalHref(proposal);
    const rows = proposal.records || [];

    const apply = async () => {
        if (guard.busy) return;
        guard.busy = true;
        setBusy(true);
        setError(false);
        try {
            const entry = await applyProposal(userId, proposal);
            notifyDataChanged();
            showToast(t('evidence.sheet.applied'), 'success');
            onApplied?.(entry);
            onClose();
        } catch (err) {
            console.error('[assistant] apply failed', err);
            setError(true);
        } finally {
            guard.busy = false;
            setBusy(false);
        }
    };

    const record = (r, extra) => (
        <li key={r.id} className="flex items-center gap-2 py-1.5 text-sm" data-testid="proposal-record">
            <span className="min-w-0 flex-1 truncate text-ink">{r.merchant}</span>
            <span className="shrink-0 text-ink-muted">{r.date}</span>
            <span className="shrink-0 font-mono text-ink" dir="ltr">{money(r.amount, r.currency)}</span>
            {extra}
        </li>
    );

    return (
        <Sheet open={!!proposal} onClose={onClose} label={t('evidence.sheet.title')}>
            <div className="flex flex-col gap-3 px-5 pb-5" data-testid="proposal-sheet">
                <h2 className="font-display text-xl font-bold text-ink">{t('evidence.sheet.title')}</h2>
                <p className="text-base font-semibold text-ink">{proposalLabel(proposal, t)}</p>
                <p className="text-sm text-ink-muted">{proposal.type === 'prepare_correction' ? '' : t('evidence.sheet.intro')}</p>
                {proposal.note ? <p className="text-sm text-ink-muted">{proposal.note}</p> : null}

                {proposal.type === 'recategorise' ? (
                    <ul className="flex flex-col divide-y divide-line">
                        {rows.slice(0, MAX_ROWS).map((r) =>
                            record(
                                r,
                                <span className="flex shrink-0 items-center gap-1 text-xs text-ink-muted">
                                    {localizeCategory(r.category || 'Other')}
                                    <ArrowRight size={12} className="rtl:rotate-180" aria-hidden="true" />
                                    <span className="font-semibold text-ink">{localizeCategory(proposal.category)}</span>
                                </span>
                            )
                        )}
                        {rows.length > MAX_ROWS ? <li className="py-1.5 text-sm text-ink-muted">{t('evidence.sheet.more', { count: rows.length - MAX_ROWS })}</li> : null}
                    </ul>
                ) : null}
                {proposal.type === 'create_recurring' ? <ul className="flex flex-col divide-y divide-line">{rows.map((r) => record(r))}</ul> : null}
                {proposal.type === 'mark_duplicate' ? (
                    <ul className="flex flex-col divide-y divide-line">
                        {record(proposal.keep, <span className="shrink-0 text-xs font-semibold text-income">{t('evidence.sheet.keep')}</span>)}
                        {record(proposal.remove, <span className="shrink-0 text-xs font-semibold text-over-ink">{t('evidence.sheet.remove')}</span>)}
                    </ul>
                ) : null}
                {proposal.type === 'prepare_correction' ? record(proposal.record) : null}

                {error ? <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn-ink" role="alert">{t('evidence.sheet.failed')}</p> : null}

                {href ? (
                    <Link to={href} onClick={onClose} className="flex h-14 items-center justify-center rounded-[18px] bg-forest text-base font-semibold text-white">
                        {t('evidence.sheet.open')}
                    </Link>
                ) : (
                    <button type="button" onClick={apply} disabled={busy} className="flex h-14 items-center justify-center gap-2 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-60" data-testid="proposal-apply">
                        {busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : null}
                        {busy ? t('evidence.sheet.applying') : t('evidence.sheet.apply')}
                    </button>
                )}
                <button type="button" onClick={onClose} className="flex h-12 items-center justify-center rounded-[18px] border border-line-strong bg-surface text-sm font-semibold text-ink">
                    {t('common.actions.cancel')}
                </button>
            </div>
        </Sheet>
    );
}
