import { Link } from 'react-router-dom';
import { Amount } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { monthProgress, safeToSpendPerDay } from '../../utils/monthMath';

/** "The month as a receipt" (docs/design/Main.dc.html): spent vs whole-month budget with pace tick, income, saved, travel, safe to spend. */
export default function MonthReceipt({ month, totals, wholeBudget, today }) {
    const { t, languageCode } = useTranslation();
    const { short, num, currency } = useMoney();
    const progress = monthProgress(month, today);
    const current = progress.state === 'current';
    const budget = wholeBudget ? wholeBudget.amount : null;
    const pct = budget ? Math.round((totals.spent / budget) * 100) : null;
    const ahead = wholeBudget && current && wholeBudget.status !== 'ok';
    const safe = budget && current ? safeToSpendPerDay({ budget, spent: totals.spent, upcoming: totals.upcoming, month, today }) : null;
    const dateText = current ? new Intl.DateTimeFormat(languageCode, { day: 'numeric', month: 'short' }).format(today) : '';
    const row = 'flex items-baseline text-sm';
    const val = 'mono-num font-medium';

    return (
        <section className="flex flex-col gap-2.5 rounded-3xl bg-forest px-5 pb-[18px] pt-5 text-white" data-testid="month-receipt" aria-label={t('home.spentSoFar')}>
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold uppercase tracking-[.06em] opacity-80">{current ? t('home.spentSoFar') : t('home.spentInMonth')}</span>
                {current ? <span className="text-xs opacity-80">{t('home.dateLeft', { date: dateText, count: progress.daysLeft })}</span> : null}
            </div>
            <div className="flex items-baseline gap-1.5">
                <Amount value={totals.spent} className="text-[44px] font-semibold leading-none tracking-tight" />
                <span className="font-mono text-lg opacity-80">{currency}</span>
            </div>
            {budget ? (
                <>
                    <div className="relative h-2 rounded bg-white/20" role="progressbar" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={Math.min(totals.spent, budget)} aria-label={t('budgets.wholeMonth')}>
                        <div className="h-full rounded bg-white" style={{ width: `${Math.max(0, Math.min(100, (totals.spent / budget) * 100))}%` }} />
                        {current ? <span aria-hidden="true" className="absolute -top-[3px] h-3.5 w-0.5 bg-[#FFD88A]" style={{ insetInlineStart: `${progress.pct}%` }} /> : null}
                    </div>
                    <div className="flex justify-between gap-2 text-xs opacity-90">
                        <span>{t('home.pctOfBudget', { pct, budget: short(budget, currency) })}</span>
                        {current ? <span className={ahead ? 'text-[#FFD88A]' : ''}>{ahead ? t('home.aheadOfPace', { day: progress.day }) : t('home.onPace')}</span> : null}
                    </div>
                </>
            ) : (
                <Link to="/plan" className="flex min-h-[44px] items-center text-[13px] font-semibold underline underline-offset-2">
                    {t('home.setBudget')}
                </Link>
            )}
            <div className="my-1 h-px bg-white/20" />
            <div className={row}>
                <span>{t('home.income')}</span>
                <span className="lead" aria-hidden="true" />
                <span className={val}>{num(totals.income)}</span>
            </div>
            {totals.income > 0 ? (
                <div className={row}>
                    <span>{t('home.saved')}</span>
                    <span className="lead" aria-hidden="true" />
                    <span className={val}>{num(totals.saved)}{totals.savingsRate !== null ? ` · ${Math.round(totals.savingsRate * 100)}%` : ''}</span>
                </div>
            ) : (
                <p className="text-[13px] opacity-90">{t('savings.noIncome')}</p>
            )}
            {totals.travelByTrip.map((trip) => (
                <Link key={trip.tripId} to={`/trips/${trip.tripId}`} className={`${row} min-h-[28px]`}>
                    <span>{t('home.travel', { name: trip.name })}</span>
                    <span className="lead" aria-hidden="true" />
                    <span className={val}>{num(trip.total)}</span>
                </Link>
            ))}
            {totals.upcoming > 0 ? (
                <div className={row}>
                    <span>{t('home.stillToPay')}</span>
                    <span className="lead" aria-hidden="true" />
                    <span className={val}>{num(totals.upcoming)}</span>
                </div>
            ) : null}
            {safe !== null ? (
                <div className="mt-0.5 flex items-baseline text-[15px] font-semibold">
                    <span>{t('home.safeToSpend')}</span>
                    <span className="lead" aria-hidden="true" />
                    <span className="mono-num">{t('home.perDay', { amount: short(safe, currency) })}</span>
                </div>
            ) : null}
        </section>
    );
}
