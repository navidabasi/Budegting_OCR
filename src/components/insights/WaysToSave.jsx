import { useEffect, useMemo, useState } from 'react';
import OpportunityCard from './OpportunityCard';
import ProposalSheet from './ProposalSheet';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { useAppStore } from '../../store/appStore';
import { displayName } from '../../utils/merchant';
import { isSavingsKind, shareAmount } from '../../utils/money';
import { opportunityHref } from '../../services/opportunityText';
import { totalMonthlySaving } from '../../services/savingsOpportunities';

const brief = (tx) => ({ id: tx.id, merchant: displayName(tx.merchant) || tx.merchant || '', date: String(tx.date || '').slice(0, 10), amount: Number(tx.total) || 0, currency: tx.currency || 'EUR', category: tx.category || '' });

/**
 * "Ways to save" (pass 3, A3): up to five opportunity cards computed on the device, each with one action that works:
 *   set_budget          the prefilled budget sheet on Plan
 *   open_filter / review_subscription / categorise   Activity filtered to the exact dates and subject of the card
 *   mark_recurring      a preview sheet; the change is applied on confirm and can be undone from the AI history
 *   add_goal            the prefilled transfer to the goal (nothing is saved until the owner saves it)
 * "Hide" hides a suggestion for 60 days (synced), with Undo, and the model is told it was dismissed.
 * The suggestions are one compact list: one row each (title and saving per month); the top one starts open, one is open at a time.
 */
export default function WaysToSave({ opportunities, explanations, transactions, accounts = [], goals = [], periodSpec, hiddenCount = 0, onDismiss, onRestore }) {
    const { t } = useTranslation();
    const { short } = useMoney();
    const openQuickAdd = useAppStore((s) => s.openQuickAdd);
    const showToast = useAppStore((s) => s.showToast);
    const [proposal, setProposal] = useState(null);
    const [busy, setBusy] = useState(null);
    const firstKey = opportunities[0]?.key || null;
    const [openKey, setOpenKey] = useState(firstKey);
    // a new period (or a hidden suggestion) brings a new top suggestion: open that one
    useEffect(() => setOpenKey((k) => (opportunities.some((o) => o.key === k) ? k : firstKey)), [firstKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const byId = useMemo(() => new Map(transactions.map((tx) => [tx.id, tx])), [transactions]);
    const total = totalMonthlySaving(opportunities);

    const actionFor = (o) => {
        const href = opportunityHref(o, { periodSpec });
        if (href) return { href };
        if (o.action.type === 'mark_recurring') {
            const tx = byId.get(o.action.txId);
            return tx ? { onClick: () => setProposal({ id: `opp-${o.key}`, type: 'create_recurring', source: 'local', frequency: o.action.frequency || 'monthly', records: [brief(tx)] }) } : {};
        }
        if (o.action.type === 'add_goal') {
            const goal = goals.find((g) => g.id === o.action.goalId);
            if (!goal) return {};
            const to = goal.accountId || accounts.find((a) => isSavingsKind(a.kind))?.id || null;
            const from = accounts.find((a) => a.id !== to && (a.kind === 'spending' || a.kind === 'cash'))?.id || accounts.find((a) => a.id !== to)?.id || null;
            return { onClick: () => openQuickAdd({ initial: { transactionType: 'transfer', accountId: from, toAccountId: to, goalId: goal.id, total: o.action.amount, merchant: goal.name } }) };
        }
        return {};
    };
    const dismiss = async (o) => {
        setBusy(o.key);
        try {
            await onDismiss(o.key);
            showToast(t('insights.save.dismissed'), 'success', { action: { label: t('insights.save.undo'), onClick: () => onRestore([o.key]) } });
        } catch {
            showToast(t('insights.save.failed'), 'error');
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className="flex flex-col gap-2.5" aria-labelledby="save-title" data-testid="ways-to-save">
            <div className="flex items-baseline justify-between gap-3">
                <h2 id="save-title" className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">{t('insights.save.title')}</h2>
                {total > 0 ? <span className="shrink-0 text-[13px] font-semibold text-forest-ink" data-testid="save-total">{t('insights.save.total', { amount: short(total) })}</span> : null}
            </div>
            {opportunities.length === 0 ? (
                <p className="rounded-[14px] bg-tint px-3.5 py-3 text-sm leading-relaxed text-ink-muted" data-testid="save-empty">{t('insights.save.empty')}</p>
            ) : (
                <ul className="flex flex-col divide-y divide-line rounded-[20px] bg-surface shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line">
                    {opportunities.map((o) => (
                        <li key={o.id}>
                            <OpportunityCard
                                opportunity={o}
                                open={openKey === o.key}
                                onToggle={() => setOpenKey((k) => (k === o.key ? null : o.key))}
                                ai={explanations?.get(o.key) || null}
                                records={o.evidence.map((id) => byId.get(id)).filter(Boolean).map((tx) => ({ id: tx.id, merchant: displayName(tx.merchant) || tx.merchant || '', date: tx.date, amount: shareAmount(tx) }))}
                                action={actionFor(o)}
                                onDismiss={() => dismiss(o)}
                                busy={busy === o.key}
                            />
                        </li>
                    ))}
                </ul>
            )}
            {hiddenCount > 0 ? (
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-muted" data-testid="save-hidden">
                    {t('insights.save.hidden', { count: hiddenCount })}
                    <button type="button" onClick={() => onRestore()} className="min-h-[44px] font-semibold text-forest-ink">{t('insights.save.restore')}</button>
                </p>
            ) : null}
            <ProposalSheet proposal={proposal} onClose={() => setProposal(null)} />
        </section>
    );
}
