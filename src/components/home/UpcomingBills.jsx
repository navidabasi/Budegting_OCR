import { Link } from 'react-router-dom';
import { Amount, Card } from '../ui';
import { useAppStore } from '../../store/appStore';
import { useMarkTransactionDone } from '../../data/hooks';
import { useTranslation } from '../../languages/useTranslation';
import { daysBetween, dateKey } from '../../utils/monthMath';

/** Unpaid (planned) transactions, soonest first, with a Paid button. `unpaid` = already sorted list. */
export default function UpcomingBills({ unpaid, today }) {
    const { t, localizeCategory } = useTranslation();
    const showToast = useAppStore((s) => s.showToast);
    const markDone = useMarkTransactionDone();
    if (unpaid.length === 0) return null;
    const todayKey = dateKey(today);

    const pay = async (tx) => {
        try {
            await markDone(tx.id);
            showToast(t('home.markedPaid', { name: tx.merchant || '' }), 'success');
        } catch {
            showToast(t('quickAdd.saveFailed'), 'error');
        }
    };
    const due = (tx) => {
        const d = daysBetween(todayKey, dateKey(tx.date));
        return d < 0 ? t('home.overdue') : d === 0 ? t('home.dueToday') : t('home.dueIn', { count: d });
    };

    return (
        <section className="flex flex-col gap-2.5" aria-label={t('home.upcoming')}>
            <div className="flex items-baseline justify-between px-0.5">
                <h2 className="font-display text-[17px] font-bold text-ink">{t('home.upcoming')}</h2>
                <Link to="/activity?tracking=open&m=all" className="flex h-11 items-center text-[13px] font-semibold text-forest-ink">
                    {t('home.unpaid', { count: unpaid.length })}
                </Link>
            </div>
            <Card className="!rounded-[20px] !py-1" data-testid="upcoming">
                {unpaid.slice(0, 3).map((tx) => {
                    const soon = daysBetween(todayKey, dateKey(tx.date)) <= 3;
                    return (
                        <div key={tx.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                            <Link to={`/receipts/${tx.id}`} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3">
                                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] font-mono text-xs font-semibold ${soon ? 'bg-warn-soft text-warn-ink' : 'bg-tint text-ink-muted'}`}>{Number(String(tx.date).slice(8, 10))}</span>
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-[15px] font-medium text-ink">{tx.merchant}</span>
                                    <span className="truncate text-xs text-ink-muted">{[localizeCategory(tx.category), due(tx)].join(' · ')}</span>
                                </span>
                                <Amount value={Number(tx.total)} className="shrink-0 text-[15px]" />
                            </Link>
                            <button type="button" onClick={() => pay(tx)} className="h-11 min-w-[56px] shrink-0 rounded-xl border border-line-strong bg-surface px-3 text-[13px] font-semibold text-forest-ink">
                                {t('home.paid')}
                            </button>
                        </div>
                    );
                })}
            </Card>
        </section>
    );
}
