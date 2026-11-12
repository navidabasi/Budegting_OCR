import { useMemo, useState } from 'react';
import { ChevronDown, History, RefreshCw } from 'lucide-react';
import { PeriodSwitcher } from '../components/ui';
import VerdictStrip from '../components/insights/VerdictStrip';
import WhereMoneyWent from '../components/insights/WhereMoneyWent';
import WaysToSave from '../components/insights/WaysToSave';
import WinsWatchouts from '../components/insights/WinsWatchouts';
import FindingsList from '../components/insights/FindingsList';
import ChatPanel from '../components/insights/ChatPanel';
import ChatHistorySheet from '../components/insights/ChatHistorySheet';
import { useKeepChatHistory } from '../services/chatPrefs';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { usePlanData } from '../hooks/usePlanData';
import { usePeople } from '../hooks/usePeople';
import { useCategories } from '../hooks/useCategories';
import { useMerchantRules } from '../data/hooks';
import { suggestForMerchant } from '../services/categorizer';
import { usePeriod } from '../hooks/usePayCycle';
import { useMoney } from '../hooks/useMoney';
import { useInsightsNarrative } from '../hooks/useInsightsNarrative';
import { useDismissedOpportunities } from '../hooks/useDismissedOpportunities';
import { useTranslation } from '../languages/useTranslation';
import { buildAggregates, buildRefMap, verdictFigures } from '../services/insightsAggregates';
import { computeInsights } from '../services/insightsEngine';
import { computeOpportunities } from '../services/savingsOpportunities';
import { explanationsFor, topCategories, winsAndWatchouts } from '../services/insightsView';
import { findingHref, findingText } from '../services/insightText';

/**
 * Insights (pass 3, A3). Phone order: verdict strip, where the money went, ways to save (the centre of the page), wins and
 * watch-outs, then the chat. Every figure is computed on the device; the AI only words the verdict and the explanations, and the
 * page is complete without it (offline, not set up, or when its text was rejected by the number check).
 */
export default function InsightsPage() {
    const { t, languageCode, localizeCategory } = useTranslation();
    const { short } = useMoney();
    const [historyOpen, setHistoryOpen] = useState(false);
    const [allOpen, setAllOpen] = useState(false);
    const [keepHistory] = useKeepChatHistory();
    const p = usePeriod();
    const month = p.period;
    const { transactions, trips, groups, accounts, budgets, goals, currency, loading } = usePlanData();
    const today = useMemo(() => new Date(), []);
    const { dismissed, dismiss, restore } = useDismissedOpportunities(p.today);
    const opp = useMemo(
        () => (loading ? { top: [], all: [], dismissed: [] } : computeOpportunities({ transactions, budgets, goals, accounts, trips, groups, period: month, today: p.today, dismissed })),
        [loading, transactions, budgets, goals, accounts, trips, groups, month, p.today, dismissed]
    );
    const findings = useMemo(() => (loading ? [] : computeInsights({ transactions, budgets, goals, accounts, trips, groups, month, today, currency })), [loading, transactions, budgets, goals, accounts, trips, groups, month, today, currency]);
    const aggregates = useMemo(
        () => (loading ? null : buildAggregates({ transactions, budgets, goals, accounts, trips, groups, month, today, currency, opportunities: opp.top, dismissed: opp.dismissed })),
        [loading, transactions, budgets, goals, accounts, trips, groups, month, today, currency, opp]
    );
    const figures = useMemo(() => (loading ? null : verdictFigures({ transactions, budgets, accounts, trips, period: month, today: p.today })), [loading, transactions, budgets, accounts, trips, month, p.today]);
    const where = useMemo(() => (loading ? null : topCategories({ transactions, trips, period: month, today: p.today })), [loading, transactions, trips, month, p.today]);
    const refMap = useMemo(() => buildRefMap(findings, opp.top), [findings, opp.top]);
    const { people } = usePeople();
    const categoryList = useCategories();
    const { rules } = useMerchantRules();
    const categoryNames = useMemo(() => categoryList.map((c) => (typeof c === 'string' ? c : c.name)).filter((n) => n && n !== 'Income' && n !== 'Transfer'), [categoryList]);
    // everything the assistant's evidence is computed from (src/services/evidencePack.js); nothing here leaves the device
    const ctx = useMemo(
        () =>
            loading
                ? null
                : {
                      transactions, trips, groups, accounts, budgets, goals, people, dismissed, period: p.period, config: p.config, today: p.today, currency, categoryNames,
                      suggest: (tx) => suggestForMerchant({ merchant: tx.merchant, items: tx.lineItems, rules, transactions, names: categoryNames }),
                  },
        [loading, transactions, trips, groups, accounts, budgets, goals, people, dismissed, p.period, p.config, p.today, currency, categoryNames, rules]
    );
    const narrative = useInsightsNarrative({ aggregates, language: languageCode, enabled: transactions.length > 0, refMap });
    const explanations = useMemo(() => explanationsFor(opp.top, narrative.data, narrative.refs), [opp.top, narrative.data, narrative.refs]);
    const lists = useMemo(() => {
        const text = (f) => findingText(f, { t, money: (n) => short(n), localizeCategory });
        const raw = winsAndWatchouts({ findings, narrative: narrative.data, refs: narrative.refs, stale: narrative.stale, findingText: text });
        const byId = new Map(findings.map((f) => [f.id, f]));
        const link = (n) => ({ text: n.text, detail: n.detail, href: n.findingId && byId.has(n.findingId) ? findingHref(byId.get(n.findingId)) : n.opportunityKey && opp.top.some((o) => o.key === n.opportunityKey) ? `#opp-${n.opportunityKey}` : null });
        return { wins: raw.wins.map(link), watchouts: raw.watchouts.map(link) };
    }, [findings, narrative.data, narrative.refs, narrative.stale, opp.top, t, short, localizeCategory]);
    if (loading) return <LoadingSpinner className="pb-20" />;
    const title = p.label;
    const busy = narrative.status === 'loading';
    const empty = transactions.length === 0;

    return (
        // Phone: one column. Tablet: one wider column, cards and lists two by two. PC: the insights on the left and the assistant as a
        // sticky pane on the right, so no width is left empty and the conversation is always in reach.
        <main className="mx-auto w-full max-w-[1000px] px-5 pb-[192px] pt-[max(env(safe-area-inset-top),16px)] md:px-8 desk:max-w-[1480px] desk:pb-6">
            <div className="flex flex-col gap-5 desk:grid desk:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] desk:items-start desk:gap-6">
                <div className="flex min-w-0 flex-col gap-5">
            <div className="flex items-end justify-between gap-3 pt-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-semibold uppercase tracking-[.08em] text-ink-muted">{t('nav.insights')}</span>
                    <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {keepHistory ? (
                        <button type="button" onClick={() => setHistoryOpen(true)} aria-label={t('chat.historyButton')} title={t('chat.historyButton')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface text-forest-ink" data-testid="chat-history-button">
                            <History size={18} aria-hidden="true" />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={narrative.refresh}
                        disabled={busy || !narrative.online || empty}
                        className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3.5 text-[13px] font-semibold text-forest-ink disabled:opacity-40"
                    >
                        <RefreshCw size={15} aria-hidden="true" className={busy ? 'animate-spin' : ''} />
                        {t('insights.refresh')}
                    </button>
                </div>
            </div>
            <PeriodSwitcher p={p} />
            {empty ? (
                <p className="rounded-[14px] bg-tint px-3.5 py-3 text-sm text-ink-muted">{t('insights.noFindings')}</p>
            ) : (
                <>
                    <VerdictStrip figures={figures} narrative={narrative} onRetry={narrative.retry} onUpdate={narrative.refresh} canUpdate={!busy && narrative.online} />
                    <WaysToSave opportunities={opp.top} explanations={explanations} transactions={transactions} accounts={accounts} goals={goals} periodSpec={p.spec} hiddenCount={opp.dismissed.length} onDismiss={dismiss} onRestore={() => restore(opp.dismissed.map((o) => o.key))} />
                    {/* side by side from tablet width: where the money went | wins, watch-outs and every finding */}
                    <div className="grid gap-5 md:grid-cols-2 md:items-start">
                        <WhereMoneyWent view={where} periodSpec={p.spec} />
                        <div className="flex min-w-0 flex-col gap-4">
                            <WinsWatchouts wins={lists.wins} watchouts={lists.watchouts} />
                            {findings.length > 0 ? (
                                <section className="flex min-w-0 flex-col gap-2" data-testid="all-findings">
                                    <button type="button" onClick={() => setAllOpen((v) => !v)} aria-expanded={allOpen} className="flex min-h-[44px] items-center justify-between gap-2 text-start text-sm font-semibold text-forest-ink">
                                        {t('insights.more.title', { count: findings.length })}
                                        <ChevronDown size={16} className={`shrink-0 transition-transform duration-inline ease-out ${allOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                                    </button>
                                    {allOpen ? <FindingsList findings={findings} /> : null}
                                </section>
                            ) : null}
                        </div>
                    </div>
                </>
            )}
                </div>
                <ChatPanel ctx={ctx} month={aggregates?.month || p.key} language={languageCode} />
            </div>
            <ChatHistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} />
        </main>
    );
}
