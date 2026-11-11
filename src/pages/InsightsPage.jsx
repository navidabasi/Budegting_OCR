import { useMemo, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { PeriodSwitcher } from '../components/ui';
import NarrativeCard from '../components/insights/NarrativeCard';
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
import { useInsightsNarrative } from '../hooks/useInsightsNarrative';
import { useTranslation } from '../languages/useTranslation';
import { buildAggregates } from '../services/insightsAggregates';
import { computeInsights } from '../services/insightsEngine';

/** Insights (docs/design/Insights.dc.html): AI narrative on top, deterministic findings below (chat is added by ChatPanel). */
export default function InsightsPage() {
    const { t, languageCode } = useTranslation();
    const [historyOpen, setHistoryOpen] = useState(false);
    const [keepHistory] = useKeepChatHistory();
    const p = usePeriod();
    const month = p.period;
    const { transactions, trips, accounts, budgets, goals, currency, loading } = usePlanData();
    const today = useMemo(() => new Date(), []);
    const aggregates = useMemo(
        () => (loading ? null : buildAggregates({ transactions, budgets, goals, accounts, trips, month, today, currency })),
        [loading, transactions, budgets, goals, accounts, trips, month, today, currency]
    );
    const findings = useMemo(() => (loading ? [] : computeInsights({ transactions, budgets, goals, accounts, trips, month, today, currency })), [loading, transactions, budgets, goals, accounts, trips, month, today, currency]);
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
                      transactions, trips, accounts, budgets, goals, people, period: p.period, config: p.config, today: p.today, currency, categoryNames,
                      suggest: (tx) => suggestForMerchant({ merchant: tx.merchant, items: tx.lineItems, rules, transactions, names: categoryNames }),
                  },
        [loading, transactions, trips, accounts, budgets, goals, people, p.period, p.config, p.today, currency, categoryNames, rules]
    );
    const narrative = useInsightsNarrative({ aggregates, language: languageCode, enabled: transactions.length > 0 });

    if (loading) return <LoadingSpinner className="pb-20" />;
    const title = p.label;
    const busy = narrative.status === 'loading';

    return (
        <main className="flex flex-col gap-3 px-5 pb-[260px] pt-[max(env(safe-area-inset-top),16px)]">
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
                        disabled={busy || !narrative.online || transactions.length === 0}
                        className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3.5 text-[13px] font-semibold text-forest-ink disabled:opacity-40"
                    >
                        <RefreshCw size={15} aria-hidden="true" className={busy ? 'animate-spin' : ''} />
                        {t('insights.refresh')}
                    </button>
                </div>
            </div>
            <PeriodSwitcher p={p} />
            {transactions.length > 0 ? <NarrativeCard status={narrative.status} data={narrative.data} onRetry={narrative.retry} stale={narrative.stale} onUpdate={narrative.refresh} canUpdate={!busy && narrative.online} /> : null}
            <FindingsList findings={findings} />
            <ChatPanel ctx={ctx} month={aggregates?.month || p.key} language={languageCode} extraQuestions={narrative.data?.questions || []} />
            <ChatHistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} />
        </main>
    );
}
