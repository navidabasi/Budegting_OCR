import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, Chip, ChipRow, IconButton, MonthSwitcher } from '../components/ui';
import DrillSheet from '../components/breakdown/DrillSheet';
import { subcategoryLabel } from '../components/receipts/subcategoryLabel';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { usePlanData } from '../hooks/usePlanData';
import { useSelectedMonth } from '../hooks/useSelectedMonth';
import { monthLabel, useMoney } from '../hooks/useMoney';
import { useTranslation } from '../languages/useTranslation';
import { changeBetween, comparableUnitPrices, coverage, recurringProducts, spendByCategory, spendByMerchant, spendBySubcategory } from '../utils/itemAnalysis';
import { comparablePeriods, previousMonthRange } from '../utils/period';

const cap = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';

function Row({ label, value, bar, onClick, hint, testid }) {
    return (
        <button type="button" onClick={onClick} className="flex min-h-[56px] w-full flex-col justify-center gap-1.5 border-b border-line py-2 text-start last:border-0" data-testid={testid}>
            <span className="flex items-baseline gap-2 text-sm text-ink">
                <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                <span className="shrink-0 font-mono text-[15px]" dir="ltr">
                    {value}
                </span>
            </span>
            {bar !== undefined ? (
                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-tint" aria-hidden="true">
                    <span className="block h-full rounded-full bg-forest" style={{ width: `${Math.max(2, Math.min(100, bar * 100))}%` }} />
                </span>
            ) : null}
            {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
        </button>
    );
}

/** Spending breakdown: merchants, grocery subcategories from items, coverage, recurring products, unit prices, change vs the comparable earlier period. */
export default function BreakdownPage() {
    const { t, languageCode, localizeCategory, isRtl } = useTranslation();
    const navigate = useNavigate();
    const { money, num } = useMoney();
    const { transactions, loading } = usePlanData();
    const { month, isCurrent, prev, next } = useSelectedMonth();
    const [category, setCategory] = useState('Groceries');
    const [drill, setDrill] = useState(null);
    const today = useMemo(() => new Date(), []);

    const period = month;
    const cats = useMemo(() => spendByCategory(transactions, period).map((g) => g.key), [transactions, period]);
    const catChips = useMemo(() => ['', ...new Set(['Groceries', ...cats])], [cats]);
    const merchants = useMemo(() => spendByMerchant(transactions, period, { category: category || undefined }), [transactions, period, category]);
    const groups = useMemo(() => (category ? spendBySubcategory(transactions, period, { category }) : spendByCategory(transactions, period)), [transactions, period, category]);
    const cover = useMemo(() => coverage(transactions, period, { category: category || undefined }), [transactions, period, category]);
    const recurring = useMemo(() => recurringProducts(transactions, period, { minReceipts: 2 }).slice(0, 6), [transactions, period]);
    const unitPrices = useMemo(() => comparableUnitPrices(transactions, period).slice(0, 5), [transactions, period]);
    const cmp = useMemo(() => comparablePeriods(period, today, previousMonthRange), [period, today]);
    const change = useMemo(
        () => (cmp ? changeBetween(transactions, cmp.current, cmp.previous, { by: category ? 'subcategory' : 'category', category: category || undefined }) : null),
        [transactions, cmp, category]
    );

    if (loading) return <LoadingSpinner className="pb-20" />;

    const periodText = isCurrent ? t('breakdown.thisPeriod') : monthLabel(month, languageCode);
    const scopeName = category ? localizeCategory(category) : t('breakdown.allSpending');
    const maxMerchant = Math.max(1, ...merchants.map((m) => m.total));
    const maxGroup = Math.max(1, ...groups.map((g) => g.total));
    const Back = isRtl ? ChevronRight : ChevronLeft;

    return (
        <main className="flex flex-col gap-3.5 px-5 pb-32 pt-[max(env(safe-area-inset-top),16px)]" data-testid="breakdown-page">
            <div className="flex items-center gap-1 pt-3">
                <IconButton label={t('common.actions.back')} icon={Back} size={22} onClick={() => navigate(-1)} />
                <h1 className="font-display text-[26px] font-bold tracking-tight text-ink">{t('breakdown.title')}</h1>
            </div>
            <MonthSwitcher month={month} onPrev={prev} onNext={next} canNext={!isCurrent} className="self-start" />
            <p className="text-xs text-ink-muted">{t('breakdown.basisShare')}</p>

            <ChipRow>
                {catChips.map((c) => (
                    <Chip key={c || 'all'} selected={category === c} onClick={() => setCategory(c)}>
                        {c ? localizeCategory(c) : t('breakdown.allSpending')}
                    </Chip>
                ))}
            </ChipRow>

            <Card className={`!rounded-[18px] ${cover.receipts === 0 ? '' : cover.share < 0.5 ? '!bg-warn-soft' : '!bg-mint'}`} data-testid="coverage-banner">
                {cover.receipts === 0 ? (
                    <p className="text-sm text-ink-muted">{t('breakdown.noSpend', { scope: scopeName })}</p>
                ) : (
                    <>
                        <p className="text-sm font-semibold text-ink">{t('breakdown.coverage', { pct: Math.round(cover.share * 100), scope: scopeName.toLowerCase(), period: periodText })}</p>
                        <p className="mt-0.5 text-xs text-ink-muted">{t('breakdown.coverageDetail', { itemised: money(cover.itemised), total: money(cover.total), unknown: money(cover.unknown), withItems: cover.receiptsWithItems, receipts: cover.receipts })}</p>
                    </>
                )}
            </Card>

            <section className="flex flex-col gap-1" aria-label={t('breakdown.merchants')}>
                <h2 className={cap}>{t('breakdown.merchants')}</h2>
                <Card className="!rounded-[18px] !py-1">
                    {merchants.length === 0 ? <p className="py-3 text-sm text-ink-muted">{t('breakdown.empty')}</p> : null}
                    {merchants.slice(0, 8).map((m, i) => (
                        <Row
                            key={m.key}
                            testid="merchant-row"
                            label={`${i + 1}. ${m.name}`}
                            value={money(m.total)}
                            bar={m.total / maxMerchant}
                            hint={t('breakdown.visits', { count: m.count })}
                            onClick={() => setDrill({ title: m.name, subtitle: t('breakdown.receiptsOf', { scope: scopeName.toLowerCase() }), total: m.total, refs: m.refs })}
                        />
                    ))}
                </Card>
            </section>

            <section className="flex flex-col gap-1" aria-label={t('breakdown.byCategory')}>
                <h2 className={cap}>{category ? t('breakdown.subcategories', { category: localizeCategory(category) }) : t('breakdown.byCategory')}</h2>
                <Card className="!rounded-[18px] !py-1">
                    {groups.length === 0 ? <p className="py-3 text-sm text-ink-muted">{t('breakdown.empty')}</p> : null}
                    {groups.map((g) => (
                        <Row
                            key={g.key}
                            testid="group-row"
                            label={category ? (g.key === 'unknown' ? t('subcategory.unknown') : subcategoryLabel(t, g.key)) : localizeCategory(g.key)}
                            value={money(g.total)}
                            bar={g.total / maxGroup}
                            hint={g.unallocated > 0 ? t('breakdown.ofWhichUnitemised', { amount: money(g.unallocated) }) : undefined}
                            onClick={() => setDrill({ title: category ? (g.key === 'unknown' ? t('subcategory.unknown') : subcategoryLabel(t, g.key)) : localizeCategory(g.key), subtitle: t('breakdown.lines'), total: g.total, refs: g.refs })}
                        />
                    ))}
                </Card>
            </section>

            {change && cmp ? (
                <section className="flex flex-col gap-1" aria-label={t('breakdown.change')} data-testid="change-section">
                    <h2 className={cap}>{t('breakdown.change')}</h2>
                    <Card className="!rounded-[18px] !py-2">
                        <p className="pb-1 text-xs text-ink-muted">
                            {cmp.basis === 'elapsed'
                                ? t('breakdown.basisElapsed', { days: cmp.elapsedDays, previous: monthLabel(cmp.previous.start.slice(0, 7), languageCode) })
                                : t('breakdown.basisCompleted', { previous: monthLabel(cmp.previous.start.slice(0, 7), languageCode) })}
                        </p>
                        <p className="pb-1 text-sm font-semibold text-ink">
                            {money(change.current)} <span className="font-normal text-ink-muted">{t('breakdown.vs', { previous: money(change.previous) })}</span>
                        </p>
                        {change.rows.slice(0, 5).map((r) => (
                            <Row
                                key={r.key}
                                testid="change-row"
                                label={category ? (r.key === 'unknown' ? t('subcategory.unknown') : subcategoryLabel(t, r.key)) : localizeCategory(r.key)}
                                value={`${r.delta > 0 ? '+' : ''}${money(r.delta)}`}
                                hint={t('breakdown.changeDetail', { current: num(r.current), previous: num(r.previous) })}
                                onClick={() => setDrill({ title: r.label, subtitle: t('breakdown.lines'), total: r.current, refs: r.refs })}
                            />
                        ))}
                    </Card>
                </section>
            ) : null}

            <section className="flex flex-col gap-1" aria-label={t('breakdown.recurring')}>
                <h2 className={cap}>{t('breakdown.recurring')}</h2>
                <Card className="!rounded-[18px] !py-1">
                    {recurring.length === 0 ? <p className="py-3 text-sm text-ink-muted">{t('breakdown.recurringNone')}</p> : null}
                    {recurring.map((p) => (
                        <Row key={p.key} testid="recurring-row" label={p.name} value={money(p.total)} hint={t('breakdown.boughtTimes', { count: p.receipts, average: money(p.average) })} onClick={() => setDrill({ title: p.name, subtitle: p.merchants.join(', '), total: p.total, refs: p.refs })} />
                    ))}
                </Card>
            </section>

            {unitPrices.length > 0 ? (
                <section className="flex flex-col gap-1" aria-label={t('breakdown.unitPrices')}>
                    <h2 className={cap}>{t('breakdown.unitPrices')}</h2>
                    <Card className="!rounded-[18px] !py-1">
                        {unitPrices.map((u) => (
                            <Row
                                key={u.key}
                                testid="unit-row"
                                label={u.name}
                                value={u.comparable ? `${money(u.latest)}/${u.base}` : '-'}
                                hint={u.comparable ? t('breakdown.unitRange', { min: money(u.min), max: money(u.max), change: u.changePct === null ? '-' : `${u.changePct > 0 ? '+' : ''}${Math.round(u.changePct)}%` }) : t('breakdown.notComparable')}
                                onClick={() => setDrill({ title: u.name, subtitle: u.comparable ? t('breakdown.perUnit', { unit: u.base }) : t('breakdown.notComparable'), refs: u.points.map((p) => ({ txId: p.txId, itemId: p.itemId, name: u.name, merchant: p.merchant, date: p.date, amount: p.value })) })}
                            />
                        ))}
                    </Card>
                </section>
            ) : null}

            <Link to="/activity?type=expense" className="flex h-11 items-center gap-1 self-start text-sm font-semibold text-forest-ink">
                {t('breakdown.openActivity')}
                {isRtl ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            </Link>

            <DrillSheet open={!!drill} onClose={() => setDrill(null)} title={drill?.title} subtitle={drill?.subtitle} total={drill?.total} refs={drill?.refs || []} />
        </main>
    );
}
