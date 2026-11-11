import { Link } from 'react-router-dom';
import { Card, ProgressBar } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { WHOLE_MONTH } from '../../utils/budgetMath';

const BAR = { ok: 'ok', warning: 'warn', over: 'over' };

/** The three category budgets closest to their limit. rows = categoryBudgets(...) */
export default function BudgetStrip({ rows, month }) {
    const { t, localizeCategory } = useTranslation();
    const { num } = useMoney();
    const top = rows.filter((r) => r.category !== WHOLE_MONTH).sort((a, b) => (b.spentPct || 0) - (a.spentPct || 0)).slice(0, 3);
    return (
        <section className="flex flex-col gap-2.5" aria-label={t('nav.budgets')}>
            <div className="flex items-baseline justify-between px-0.5">
                <h2 className="font-display text-[17px] font-bold text-ink">{t('nav.budgets')}</h2>
                <Link to={`/plan?m=${month}`} className="flex h-11 items-center text-[13px] font-semibold text-forest-ink">
                    {t('home.seeAll')}
                </Link>
            </div>
            {top.length === 0 ? (
                <Link to="/plan" className="rounded-[20px] bg-tint px-4 py-3.5 text-sm text-ink-muted">
                    {t('home.noBudgets')}
                </Link>
            ) : (
                <Card className="!rounded-[20px] !py-1.5" data-testid="budget-strip">
                    {top.map((r) => (
                        <Link key={r.id} to={`/activity?m=${month}&type=expense&cat=${encodeURIComponent(r.category)}`} className="flex min-h-[56px] flex-col justify-center gap-1.5 border-b border-line py-2.5 last:border-0">
                            <span className="flex items-baseline text-sm text-ink">
                                <span className="font-medium">{localizeCategory(r.category)}</span>
                                <span className="lead" aria-hidden="true" />
                                <span dir="ltr" className="mono-num text-[13px]">
                                    <b>{num(r.spent)}</b> / {num(r.amount)}
                                </span>
                            </span>
                            <ProgressBar value={r.spent} max={r.amount} status={BAR[r.status]} label={localizeCategory(r.category)} className="!h-1.5" />
                        </Link>
                    ))}
                </Card>
            )}
        </section>
    );
}
