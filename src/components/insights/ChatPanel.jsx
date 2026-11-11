import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowUpRight } from 'lucide-react';
import { Chip, Segmented } from '../ui';
import EvidenceAnswer from './EvidenceAnswer';
import ProposalSheet from './ProposalSheet';
import AiHistory from './AiHistory';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { useKeyboardOpen } from '../../hooks/useKeyboardOpen';
import { getAccessToken } from '../../services/accessToken';
import { actionHref, loadThread, saveThread, sendEvidenceChat } from '../../services/chatApi';
import { buildEvidencePack, routeQuestion } from '../../services/evidencePack';
import { localProposals, resolveProposals } from '../../services/aiActions';
import { restoreAliases } from '../../services/aiOutbound';

const CHIPS = ['top_merchant', 'grocery_breakdown', 'change', 'unit_price', 'owed', 'review', 'budgets_goals'];
const BASIS_KEY = 'wmw.aiBasis';
const readBasis = () => {
    try {
        return localStorage.getItem(BASIS_KEY) === 'full' ? 'full' : 'share';
    } catch {
        return 'share';
    }
};

/**
 * "Ask about your money". Every question is answered from an evidence pack computed on the device (services/evidencePack.js); the
 * model only explains it and must cite fact ids. Each answer shows its period, currency, basis, item coverage and the receipts and
 * lines behind it. Bookkeeping suggestions are previewed in a sheet, applied only on confirm and kept in an undo history.
 * `ctx`: { transactions, trips, accounts, budgets, goals, people, period, config, today, currency, categoryNames, suggest }.
 */
export default function ChatPanel({ ctx, month, language, extraQuestions = [], fetchImpl, getToken = getAccessToken }) {
    const { t } = useTranslation();
    const { short } = useMoney();
    const keyboard = useKeyboardOpen();
    const [thread, setThread] = useState(() => loadThread());
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [basis, setBasis] = useState(readBasis);
    const [proposal, setProposal] = useState(null);
    const [historyKey, setHistoryKey] = useState(0);
    const endRef = useRef(null);
    const guard = useRef(false); // synchronous: two taps in one frame send one question
    const ready = !!ctx && ctx.transactions;

    useEffect(() => {
        saveThread(thread);
    }, [thread]);
    useEffect(() => {
        endRef.current?.scrollIntoView?.({ block: 'nearest' });
    }, [thread, busy]);

    const changeBasis = (b) => {
        setBasis(b);
        try {
            localStorage.setItem(BASIS_KEY, b);
        } catch {
            /* per-device convenience only */
        }
    };

    const errorKey = (err) => (['offline', 'rateLimit', 'notConfigured', 'auth'].includes(err?.kind) ? err.kind : 'server');

    const ask = async (question, { intent, base = thread } = {}) => {
        const q = question.trim();
        if (!q || guard.current || !ready) return;
        guard.current = true;
        const next = [...base, { role: 'user', content: q }];
        setThread(next);
        setText('');
        setBusy(true);
        try {
            const route = intent || routeQuestion(q);
            const { pack, refs } = buildEvidencePack({ ...ctx, intent: route, question: q, basis });
            const locals = route === 'review' ? localProposals(ctx.transactions, { period: ctx.period, today: ctx.today, suggest: ctx.suggest, categories: ctx.categoryNames }) : [];
            if (pack.insufficient) {
                // nothing to explain: answered here, no request is made
                setThread([...next, { role: 'assistant', content: t(`evidence.insufficient.${pack.insufficient}`), ev: { pack, refs, citations: [], uncertain: [], grounded: true, unsupported: [], proposals: pack.insufficient === 'nothing_to_review' ? [] : locals, state: 'insufficient' } }]);
                return;
            }
            try {
                const out = await sendEvidenceChat({ pack, thread: next, language, getToken, fetchImpl });
                const resolved = resolveProposals(out.proposals, refs, ctx.transactions, { categories: ctx.categoryNames || [] });
                const proposals = [...resolved, ...locals.filter((l) => !resolved.some((r) => r.type === l.type && JSON.stringify(r.records || r.remove) === JSON.stringify(l.records || l.remove)))];
                setThread([...next, { role: 'assistant', content: restoreAliases(out.answer), ...(out.suggestedAction ? { action: out.suggestedAction } : {}), ev: { pack, refs, citations: out.citations, uncertain: out.uncertain, grounded: out.grounded, unsupported: out.unsupported, proposals, state: 'ok' } }]);
            } catch (err) {
                // the facts were computed here, so they are still worth showing when the explanation fails
                setThread([...next, { role: 'assistant', content: t(`chat.error.${errorKey(err)}`), error: true, retry: q, intent: route, ev: { pack, refs, citations: [], uncertain: [], grounded: true, unsupported: [], proposals: locals, state: err?.kind === 'offline' ? 'offline' : 'failed' } }]);
            }
        } finally {
            guard.current = false;
            setBusy(false);
        }
    };
    const retry = (m) => ask(m.retry, { intent: m.intent, base: thread.filter((x) => x !== m).slice(0, -1) });

    const suggestions = useMemo(() => [...CHIPS.map((i) => ({ intent: i, label: t(`evidence.chip.${i}`) })), ...extraQuestions.slice(0, 2).map((q) => ({ intent: undefined, label: q }))], [extraQuestions, t]); // eslint-disable-line react-hooks/exhaustive-deps
    const actionLabel = (a) => {
        const p = a.payload || {};
        if (a.type === 'set_budget') return t('chat.action.setBudget', { category: /^(total|whole month)$/i.test(p.category) ? t('budgets.wholeMonth') : p.category, amount: short(p.amount) });
        if (a.type === 'add_goal') return t('chat.action.addGoal', { name: p.name, amount: short(p.targetAmount) });
        return t('chat.action.openFilter');
    };

    return (
        <section className="flex flex-col gap-2.5 pt-2" aria-label={t('chat.title')} data-testid="chat">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-[.06em] text-ink-muted">{t('chat.title')}</h2>
                <Segmented ariaLabel={t('evidence.basisToggle')} value={basis} onChange={changeBasis} options={[{ value: 'share', label: t('evidence.basis.share') }, { value: 'full', label: t('evidence.basis.full') }]} />
            </div>
            {thread.length > 0 ? (
                <ol className="flex flex-col gap-2" aria-live="polite">
                    {thread.map((m, i) => (
                        <li key={i} className={`flex flex-col gap-1.5 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <p className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-snug ${m.role === 'user' ? 'bg-ink text-ground dark:bg-forest dark:text-white' : m.error ? 'bg-warn-soft text-warn-ink' : 'bg-surface text-ink shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line'}`}>{m.content}</p>
                            {m.role === 'assistant' && m.ev ? <EvidenceAnswer ev={m.ev} onProposal={setProposal} /> : null}
                            {m.error && m.retry && m.content !== t('chat.error.rateLimit') ? (
                                <button type="button" onClick={() => retry(m)} className="h-11 rounded-xl px-3 text-sm font-semibold text-forest-ink">
                                    {t('insights.retry')}
                                </button>
                            ) : null}
                            {m.action && actionHref(m.action, month) ? (
                                <Link to={actionHref(m.action, month)} className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-forest-ink bg-surface px-3.5 text-sm font-semibold text-forest-ink">
                                    {actionLabel(m.action)}
                                    <ArrowUpRight size={15} aria-hidden="true" className="rtl:-scale-x-100" />
                                </Link>
                            ) : null}
                        </li>
                    ))}
                    {busy ? (
                        <li className="flex">
                            <p className="rounded-2xl bg-surface px-3.5 py-2.5 text-sm text-ink-muted dark:ring-1 dark:ring-line" role="status">{t('chat.thinking')}</p>
                        </li>
                    ) : null}
                    <li ref={endRef} aria-hidden="true" />
                </ol>
            ) : null}
            <AiHistory refreshKey={historyKey} />
            {thread.length > 0 ? (
                <button type="button" onClick={() => setThread([])} className="h-11 self-start rounded-xl px-2 text-[13px] font-semibold text-ink-muted">
                    {t('chat.clear')}
                </button>
            ) : null}
            <div className="fixed inset-x-0 z-30 border-t border-line bg-ground pt-2.5 desk:start-24 shadow-[0_-6px_16px_rgba(16,33,27,.06)]" style={keyboard.open ? { bottom: `${keyboard.inset}px`, paddingBottom: '8px' } : { bottom: 'calc(max(env(safe-area-inset-bottom), 12px) + 64px)', paddingBottom: '40px' }}>
                <div className="mx-auto flex max-w-[520px] flex-col gap-2 px-5">
                    <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto overscroll-x-contain px-5">
                        {suggestions.map((s) => (
                            <Chip key={s.label} size="sm" disabled={busy || !ready} onClick={() => ask(s.label, { intent: s.intent })}>
                                {s.label}
                            </Chip>
                        ))}
                    </div>
                    <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            ask(text);
                        }}
                    >
                        <input
                            type="text"
                            value={text}
                            maxLength={500}
                            onChange={(e) => setText(e.target.value)}
                            placeholder={t('chat.placeholder')}
                            aria-label={t('chat.inputLabel')}
                            className="h-12 min-w-0 flex-1 rounded-2xl border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink"
                        />
                        <button type="submit" aria-label={t('chat.send')} disabled={busy || !text.trim() || !ready} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-forest text-white disabled:opacity-40">
                            <ArrowUp size={20} aria-hidden="true" />
                        </button>
                    </form>
                </div>
            </div>
            <ProposalSheet proposal={proposal} onClose={() => setProposal(null)} onApplied={() => setHistoryKey((k) => k + 1)} />
        </section>
    );
}
