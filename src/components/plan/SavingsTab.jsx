import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { Amount, Card, Sheet } from '../ui';
import GoalRing from './GoalRing';
import GoalSheet from './GoalSheet';
import { useAppStore } from '../../store/appStore';
import { useRowMutations } from '../../data/hooks';
import { useTranslation } from '../../languages/useTranslation';
import { monthLabel, useMoney } from '../../hooks/useMoney';
import { useUserPrefs } from '../../hooks/useUserPrefs';
import { goalProgress } from '../../services/insightsAggregates';
import { goalMonthlyPace, goalStatus, savingsOverview } from '../../utils/savingsMath';
import { accountBalances, displayBalance, isSavingsKind, netWorth } from '../../utils/money';
import { parseLocalNumber } from '../../utils/helpers';

const DOT = { spending: '#10211B', cash: '#9AA6A0', savings: '#2458D6', investment: '#5B3A8C', debt: '#C2410C', receivable: '#1B7F55' };
const field = 'h-14 w-full rounded-[14px] border border-line-strong bg-surface px-3.5 font-mono text-2xl text-ink focus:outline-none focus:ring-2 focus:ring-forest-ink';

/** Plan > Savings & accounts (docs/design/Savings.dc.html). */
export default function SavingsTab({ month, data, goalPreset, onGoalSheetClosed }) {
    const { t, languageCode } = useTranslation();
    const { short, num, currency } = useMoney();
    const openQuickAdd = useAppStore((s) => s.openQuickAdd);
    const showToast = useAppStore((s) => s.showToast);
    const { transactions, trips, accounts, goals } = data;
    const { prefs, setPrefs } = useUserPrefs();
    const goalRows = useRowMutations('goals');
    const [goalSheet, setGoalSheet] = useState(null); // { goal } (goal null = new)
    const [targetOpen, setTargetOpen] = useState(false);
    const [targetText, setTargetText] = useState('');

    const overview = useMemo(() => savingsOverview(transactions, month, { trips, accounts }), [transactions, month, trips, accounts]);
    const balances = useMemo(() => accountBalances(accounts, transactions), [accounts, transactions]);
    const goalCards = useMemo(
        () =>
            goals.map((goal) => {
                const saved = goalProgress(goal, transactions, balances);
                const status = goalStatus({ goal, saved, pace: goalMonthlyPace(goal, transactions, month), month });
                return { goal, status };
            }),
        [goals, transactions, balances, month]
    );
    const assets = balances.filter((b) => !b.isArchived && b.kind !== 'debt' && b.kind !== 'receivable').reduce((s, b) => s + b.balance, 0);
    const hasLiabilities = balances.some((b) => b.kind === 'debt' || b.kind === 'receivable');
    const target = Number(prefs.savingsTarget) > 0 ? Number(prefs.savingsTarget) : null;
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const contribute = (goal) => {
        const to = goal.accountId || accounts.find((a) => isSavingsKind(a.kind))?.id || null;
        const from = accounts.find((a) => a.id !== to && (a.kind === 'spending' || a.kind === 'cash'))?.id || accounts.find((a) => a.id !== to)?.id || null;
        openQuickAdd({ initial: { transactionType: 'transfer', accountId: from, toAccountId: to, goalId: goal.id } });
    };

    const saveTarget = async (value) => {
        try {
            await setPrefs({ savingsTarget: value });
            setTargetOpen(false);
        } catch {
            showToast(t('savings.goalSheet.failed'), 'error');
        }
    };

    const goalSheetOpen = !!goalSheet || !!goalPreset;
    const closeGoalSheet = () => {
        setGoalSheet(null);
        onGoalSheetClosed?.();
    };

    return (
        <div className="flex flex-col gap-3">
            <section aria-label={t('savings.savedIn', { month: monthLabel(month, languageCode, { long: true }) })} className="flex flex-col gap-2 rounded-[20px] bg-[#2458D6] p-4 text-white dark:bg-[#1B3F9E]" data-testid="saved-card">
                <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold uppercase tracking-[.06em] opacity-85">{t('savings.savedIn', { month: monthLabel(month, languageCode, { long: true }).split(' ')[0] })}</span>
                    <span className="text-xs opacity-85">{overview.savingsRate !== null ? t('savings.ofIncome', { pct: Math.round(overview.savingsRate * 100) }) : ''}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                    <Amount value={overview.saved} className="text-[34px] font-semibold leading-none tracking-tight" />
                    <span className="font-mono text-[15px] opacity-85">
                        {currency}
                        {target ? ` · ${t('savings.goalOf', { amount: num(target) })}` : ''}
                    </span>
                </div>
                {target ? (
                    <div className="h-2 overflow-hidden rounded bg-white/25" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.max(0, Math.min(target, overview.saved))}>
                        <div className="h-full rounded bg-white" style={{ width: `${Math.max(0, Math.min(100, (overview.saved / target) * 100))}%` }} />
                    </div>
                ) : null}
                {overview.income === 0 ? <p className="text-[13px] opacity-90">{t('savings.noIncome')}</p> : null}
                <div className="flex items-baseline text-[13px] opacity-90">
                    <span>{t('savings.avg')}</span>
                    <span className="lead !opacity-50" aria-hidden="true" />
                    <span className="mono-num">{overview.avgSaved === null ? '—' : `${num(overview.avgSaved)}${overview.avgRate !== null ? ` · ${Math.round(overview.avgRate * 100)}%` : ''}`}</span>
                </div>
                <button type="button" onClick={() => { setTargetText(target ? String(target) : ''); setTargetOpen(true); }} className="-mb-2 -ms-2 flex h-11 w-fit items-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold">
                    <Pencil size={14} aria-hidden="true" />
                    {t('savings.setTarget')}
                </button>
            </section>

            <div className="flex items-center justify-between px-0.5 pt-1">
                <h2 className="font-display text-[17px] font-bold text-ink">{t('savings.goals')}</h2>
                <button type="button" onClick={() => setGoalSheet({ goal: null })} className="h-11 rounded-xl px-3 text-[13px] font-semibold text-forest-ink">
                    {t('savings.addGoal')}
                </button>
            </div>
            {goalCards.length === 0 ? (
                <p className="rounded-[14px] bg-tint px-3.5 py-3 text-sm text-ink-muted">{t('savings.noGoals')}</p>
            ) : (
                <div className="grid grid-cols-2 gap-2.5">
                    {goalCards.map(({ goal, status }) => (
                        <Card key={goal.id} className="!rounded-[18px] !p-3.5 flex flex-col gap-2" data-testid="goal-card">
                            <div className="flex items-center justify-between gap-2">
                                <button type="button" onClick={() => setGoalSheet({ goal })} aria-label={t('savings.editGoal', { name: goal.name })} className="min-h-[44px] min-w-0 flex-1 truncate text-start text-sm font-semibold text-ink">
                                    {goal.name}
                                </button>
                                <GoalRing pct={status.pct} />
                            </div>
                            <div className="font-mono text-base text-ink" dir="ltr">
                                <b>{num(status.saved, goal.currency)}</b> <span className="text-ink-muted">/ {num(status.target, goal.currency)}</span>
                            </div>
                            <span className="text-xs text-ink-muted">
                                {status.done
                                    ? t('savings.reached')
                                    : [
                                          status.monthsToTarget === null ? t('savings.noPace') : t('savings.monthsAtPace', { count: status.monthsToTarget }),
                                          status.neededPerMonth !== null ? t('savings.needs', { month: monthLabel(status.targetMonth, languageCode), amount: short(status.neededPerMonth, goal.currency) }) : null,
                                      ]
                                          .filter(Boolean)
                                          .join(' · ')}
                            </span>
                            <button type="button" onClick={() => contribute(goal)} className="mt-auto h-11 rounded-xl border border-line-strong text-[13px] font-semibold text-ink">
                                {t('savings.contribute')}
                            </button>
                        </Card>
                    ))}
                </div>
            )}

            <div className="flex items-baseline justify-between px-0.5 pt-1">
                <h2 className="font-display text-[17px] font-bold text-ink">{t('savings.accounts')}</h2>
                <span className="font-mono text-sm text-ink">
                    <span className="me-1.5 font-sans text-xs text-ink-muted">{t('savings.total')}</span>
                    <Amount value={assets} currency={currency} symbol />
                </span>
            </div>
            {balances.length === 0 ? (
                <p className="rounded-[14px] bg-tint px-3.5 py-3 text-sm text-ink-muted">{t('savings.noAccounts')}</p>
            ) : (
                <Card className="!rounded-[18px] !py-0.5">
                    <ul>
                        {balances
                            .filter((b) => !b.isArchived)
                            .map((b) => {
                                const account = accountById.get(b.id);
                                const shown = displayBalance(b);
                                const sub = b.kind === 'debt' ? (account?.counterparty ? t('savings.owedTo', { name: account.counterparty }) : t(`accounts.kind.${b.kind}`)) : b.kind === 'receivable' ? (account?.counterparty ? t('savings.owedToYouBy', { name: account.counterparty }) : t('savings.owedToYou')) : t(`accounts.kind.${b.kind}`);
                                return (
                                    <li key={b.id} className="border-b border-line last:border-0">
                                        <Link to={`/activity?acct=${b.id}&m=all`} className="flex min-h-[56px] items-center gap-3 py-2">
                                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: account?.color || DOT[b.kind] || '#9AA6A0' }} aria-hidden="true" />
                                            <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{b.name}</span>
                                            <span className="shrink-0 text-xs text-ink-muted">{sub}</span>
                                            <Amount value={shown} tone={b.kind === 'debt' ? 'over' : b.kind === 'receivable' ? 'income' : 'default'} className="shrink-0 text-[15px]" />
                                        </Link>
                                    </li>
                                );
                            })}
                    </ul>
                </Card>
            )}
            {balances.length > 0 ? (
                <div className="flex items-baseline px-1 text-sm text-ink" data-testid="net-worth">
                    <span className="font-semibold">{t('savings.netWorth')}</span>
                    <span className="lead" aria-hidden="true" />
                    <Amount value={netWorth(balances, { currency })} currency={currency} symbol className="font-semibold" />
                </div>
            ) : null}
            {hasLiabilities ? <p className="px-1 text-xs text-ink-muted">{t('savings.netWorthHint')}</p> : null}

            <GoalSheet
                open={goalSheetOpen}
                onClose={closeGoalSheet}
                goal={goalSheet?.goal || null}
                initial={goalSheet ? null : goalPreset}
                accounts={accounts}
                currency={currency}
                onSave={(values) => (goalSheet?.goal ? goalRows.update(goalSheet.goal.id, values) : goalRows.create(values))}
                onDelete={(goal) => goalRows.remove(goal.id)}
            />

            <Sheet open={targetOpen} onClose={() => setTargetOpen(false)} label={t('savings.targetTitle')}>
                <div className="flex flex-col gap-3 px-5 pb-2">
                    <h2 className="font-display text-lg font-bold text-ink">{t('savings.targetTitle')}</h2>
                    <p className="text-sm text-ink-muted">{t('savings.targetBody')}</p>
                    <input className={field} inputMode="decimal" dir="ltr" aria-label={t('savings.targetAmount')} value={targetText} placeholder="0" onChange={(e) => setTargetText(e.target.value.replace(/[^\d.,]/g, ''))} data-autofocus />
                    <button type="button" disabled={!(parseLocalNumber(targetText) > 0)} onClick={() => saveTarget(parseLocalNumber(targetText))} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40">
                        {t('savings.goalSheet.save')}
                    </button>
                    {target ? (
                        <button type="button" onClick={() => saveTarget(null)} className="h-12 rounded-[18px] text-sm font-semibold text-over-ink">
                            {t('savings.targetClear')}
                        </button>
                    ) : null}
                </div>
            </Sheet>
        </div>
    );
}
