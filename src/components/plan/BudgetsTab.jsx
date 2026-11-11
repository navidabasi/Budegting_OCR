import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plane } from 'lucide-react';
import { Amount, Card, ProgressBar } from '../ui';
import BudgetSheet from './BudgetSheet';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { useBudgetActions } from '../../hooks/useBudgetActions';
import { useCopyForwardBudgets } from '../../hooks/useCopyForwardBudgets';
import { useCategories } from '../../hooks/useCategories';
import { WHOLE_MONTH, categoryBudgets, notBudgeted, topVisits } from '../../utils/budgetMath';
import { monthProgress } from '../../utils/monthMath';
import { monthTotals } from '../../utils/money';

const BAR = { ok: 'ok', warning: 'warn', over: 'over' };
const TONE = { ok: 'text-ink-muted', warning: 'text-warn-ink', over: 'text-over-ink' };

const activityLink = (month, category) => {
    const p = new URLSearchParams({ m: month, type: 'expense' });
    if (category && category !== WHOLE_MONTH) p.set('cat', category);
    return `/activity?${p.toString()}`;
};

/** Plan > Budgets (docs/design/Budgets.dc.html). All maths comes from budgetMath / money. */
export default function BudgetsTab({ month, data, sheetPreset, onSheetClosed }) {
    const { t, localizeCategory } = useTranslation();
    const { short, num, currency } = useMoney();
    const { transactions, trips, accounts, budgets } = data;
    const categoryList = useCategories();
    const categoryNames = useMemo(() => categoryList.map((c) => (typeof c === 'string' ? c : c.name)).filter((n) => n !== 'Income' && n !== 'Transfer'), [categoryList]);
    const actions = useBudgetActions({ budgets, currency });
    useCopyForwardBudgets();
    const [sheet, setSheet] = useState(null); // { category }
    const preset = sheetPreset || null;

    const today = new Date();
    const progress = monthProgress(month, today);
    const current = progress.state === 'current';
    const rows = useMemo(() => categoryBudgets(budgets, transactions, month, trips, { today, accounts }), [budgets, transactions, month, trips, accounts]); // eslint-disable-line react-hooks/exhaustive-deps
    const whole = rows.find((r) => r.category === WHOLE_MONTH);
    const catRows = rows.filter((r) => r.category !== WHOLE_MONTH);
    const totals = useMemo(() => monthTotals(transactions, month, { trips, accounts }), [transactions, month, trips, accounts]);
    const unbudgeted = useMemo(() => notBudgeted(budgets, transactions, month, { trips }), [budgets, transactions, month, trips]);
    const pace = current ? progress.pct / 100 : null;
    const closeSheet = () => {
        setSheet(null);
        onSheetClosed?.();
    };
    const sheetOpen = !!sheet || !!preset;
    const sheetCategory = sheet ? sheet.category : preset?.category ?? null;

    const statusText = (r) => {
        if (r.status === 'over') {
            const visit = topVisits(transactions, month, r.category, { trips });
            const base = t('budgets.over', { amount: short(r.spent - r.amount, currency) });
            return visit ? `${base} · ${t('budgets.visits', { count: visit.visits, name: visit.name })}` : base;
        }
        if (r.status === 'warning' && current) return t('budgets.slowDown', { projected: short(r.projected, currency), perDay: short(r.perDayToStay, currency) });
        if (current) return t('budgets.onTrack');
        return t('budgets.left', { amount: short(r.remaining, currency) });
    };

    return (
        <div className="flex flex-col gap-3">
            <Card className="!rounded-[20px] !p-4" data-testid="whole-month">
                <div className="flex items-baseline justify-between">
                    <span className="text-[13px] font-semibold uppercase tracking-[.06em] text-ink-muted">{t('budgets.wholeMonth')}</span>
                    <span className="flex items-center gap-1 text-xs text-ink-muted">
                        {current ? t('budgets.dayOf', { day: progress.day, days: progress.days }) : null}
                        {whole ? (
                            <button type="button" aria-label={t('budgets.edit', { name: t('budgets.wholeMonth') })} onClick={() => setSheet({ category: WHOLE_MONTH })} className="-my-3 -me-3 flex h-11 w-11 items-center justify-center rounded-full">
                                <Pencil size={16} aria-hidden="true" />
                            </button>
                        ) : null}
                    </span>
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                    <Amount value={whole ? whole.spent : totals.spent} className="text-[30px] font-semibold tracking-tight" />
                    {whole ? <span className="font-mono text-sm text-ink-muted">{t('budgets.of', { amount: short(whole.amount, currency) })}</span> : <span className="font-mono text-sm text-ink-muted">{currency}</span>}
                </div>
                {whole ? (
                    <>
                        <div className="mt-2">
                            <ProgressBar value={whole.spent} max={whole.amount} pace={pace} status={BAR[whole.status]} label={t('budgets.wholeMonth')} />
                        </div>
                        <div className="mt-2 flex items-baseline text-[13px]">
                            <span className={`min-w-0 font-semibold ${TONE[whole.status]}`}>
                                {current ? (whole.projected > whole.amount ? t('budgets.projectedOver', { projected: short(whole.projected, currency), over: short(whole.projected - whole.amount, currency) }) : t('budgets.projectedOk', { projected: short(whole.projected, currency) })) : null}
                            </span>
                            <span className="lead !min-w-[12px]" aria-hidden="true" />
                            <span className="mono-num shrink-0 whitespace-nowrap text-ink">{whole.remaining >= 0 ? t('budgets.left', { amount: num(whole.remaining) }) : t('budgets.over', { amount: num(-whole.remaining) })}</span>
                        </div>
                    </>
                ) : (
                    <div className="mt-2 flex flex-col gap-1">
                        <p className="text-sm font-semibold text-ink">{t('budgets.emptyTitle')}</p>
                        <p className="text-sm text-ink-muted">{t('budgets.emptyBody')}</p>
                        <button type="button" onClick={() => setSheet({ category: WHOLE_MONTH })} className="mt-2 h-12 rounded-[14px] bg-forest text-sm font-semibold text-white">
                            {t('budgets.addBudget')}
                        </button>
                    </div>
                )}
            </Card>

            {catRows.length > 0 || totals.travelByTrip.length > 0 ? (
                <Card className="!rounded-[20px] !py-0.5">
                    <ul>
                        {catRows.map((r) => (
                            <li key={r.id} className="flex items-stretch border-b border-line last:border-0">
                                <Link to={activityLink(month, r.category)} aria-label={t('budgets.openCategory', { name: localizeCategory(r.category) })} className="flex min-w-0 flex-1 flex-col gap-1.5 py-3">
                                    <span className="flex items-baseline text-[15px] text-ink">
                                        <span className="min-w-0 truncate font-medium">{localizeCategory(r.category)}</span>
                                        <span className="lead" aria-hidden="true" />
                                        <span className="mono-num shrink-0 text-sm">
                                            <b>{num(r.spent)}</b> / {num(r.amount)}
                                        </span>
                                    </span>
                                    <ProgressBar value={r.spent} max={r.amount} pace={pace} status={BAR[r.status]} label={localizeCategory(r.category)} className="!h-2" />
                                    <span className={`text-xs ${r.status === 'ok' ? '' : 'font-semibold'} ${TONE[r.status]}`}>{statusText(r)}</span>
                                </Link>
                                <button type="button" aria-label={t('budgets.edit', { name: localizeCategory(r.category) })} onClick={() => setSheet({ category: r.category })} className="flex w-11 shrink-0 items-center justify-center text-ink-muted">
                                    <Pencil size={16} aria-hidden="true" />
                                </button>
                            </li>
                        ))}
                        {totals.travelByTrip.map((trip) => (
                            <li key={trip.tripId} className="border-b border-line last:border-0">
                                <Link to={`/trips/${trip.tripId}`} className="flex min-h-[56px] flex-col justify-center gap-0.5 py-3">
                                    <span className="flex items-baseline text-[15px] text-ink">
                                        <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
                                            <Plane size={15} aria-hidden="true" className="shrink-0 text-ink-muted" />
                                            {t('budgets.travelTitle', { name: trip.name })}
                                        </span>
                                        <span className="lead" aria-hidden="true" />
                                        <Amount value={trip.total} className="text-sm" />
                                    </span>
                                    <span className="text-xs text-ink-muted">{t('budgets.travelHint')}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </Card>
            ) : null}

            <div className="flex items-center justify-between gap-3 px-0.5 py-1">
                <span className="min-w-0 text-[13px] text-ink-muted">
                    {unbudgeted.length > 0 ? t('budgets.notBudgeted', { list: unbudgeted.slice(0, 3).map((u) => `${localizeCategory(u.category)} ${short(u.spent, currency)}`).join(', ') }) : ''}
                </span>
                <button type="button" onClick={() => setSheet({ category: null })} className="h-11 shrink-0 rounded-xl border border-line-strong bg-surface px-3.5 text-[13px] font-semibold text-forest-ink">
                    {t('budgets.addBudget')}
                </button>
            </div>

            <BudgetSheet
                open={sheetOpen}
                onClose={closeSheet}
                month={month}
                budgets={budgets}
                categoryNames={categoryNames}
                transactions={transactions}
                trips={trips}
                accounts={accounts}
                category={sheetCategory}
                amount={sheet ? null : preset?.amount ?? null}
                onSave={(category, amount) => actions.save(category, amount, month)}
                onRemove={(category) => actions.remove(category, month)}
            />
        </div>
    );
}
