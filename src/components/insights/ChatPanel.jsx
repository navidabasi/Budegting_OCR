import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowUpRight } from 'lucide-react';
import { Chip } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { getAccessToken } from '../../services/accessToken';
import { actionHref, loadThread, saveThread, sendChat } from '../../services/chatApi';

/**
 * "Ask about your money": suggested questions, input, thread of the last 10 turns (sessionStorage).
 * A suggestedAction renders as a link that opens the matching prefilled screen; nothing is written from here.
 */
export default function ChatPanel({ aggregates, month, language, extraQuestions = [], fetchImpl, getToken = getAccessToken }) {
    const { t } = useTranslation();
    const { short } = useMoney();
    const [thread, setThread] = useState(() => loadThread());
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const endRef = useRef(null);

    useEffect(() => saveThread(thread), [thread]);
    useEffect(() => endRef.current?.scrollIntoView?.({ block: 'nearest' }), [thread, busy]);

    const ask = async (question, base = thread) => {
        const q = question.trim();
        if (!q || busy || !aggregates) return;
        const next = [...base, { role: 'user', content: q }];
        setThread(next);
        setText('');
        setBusy(true);
        try {
            const out = await sendChat({ aggregates, thread: next, language, getToken, fetchImpl });
            setThread([...next, { role: 'assistant', content: out.answer, ...(out.suggestedAction ? { action: out.suggestedAction } : {}) }]);
        } catch (err) {
            setThread([...next, { role: 'assistant', content: t(`chat.error.${['offline', 'rateLimit', 'notConfigured', 'auth'].includes(err?.kind) ? err.kind : 'server'}`), error: true, retry: q }]);
        } finally {
            setBusy(false);
        }
    };
    const retry = (m) => ask(m.retry, thread.filter((x) => x !== m).slice(0, -1));

    const suggestions = [t('chat.q1'), t('chat.q2'), t('chat.q3'), ...extraQuestions].slice(0, 5);
    const actionLabel = (a) => {
        const p = a.payload || {};
        if (a.type === 'set_budget') return t('chat.action.setBudget', { category: /^(total|whole month)$/i.test(p.category) ? t('budgets.wholeMonth') : p.category, amount: short(p.amount) });
        if (a.type === 'add_goal') return t('chat.action.addGoal', { name: p.name, amount: short(p.targetAmount) });
        return t('chat.action.openFilter');
    };

    return (
        <section className="flex flex-col gap-2.5 pt-2" aria-label={t('chat.title')} data-testid="chat">
            <h2 className="text-xs font-semibold uppercase tracking-[.06em] text-ink-muted">{t('chat.title')}</h2>
            {thread.length > 0 ? (
                <ol className="flex flex-col gap-2" aria-live="polite">
                    {thread.map((m, i) => (
                        <li key={i} className={`flex flex-col gap-1.5 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <p className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-snug ${m.role === 'user' ? 'bg-ink text-ground dark:bg-forest dark:text-white' : m.error ? 'bg-warn-soft text-warn-ink' : 'bg-surface text-ink shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line'}`}>{m.content}</p>
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
            <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
                {suggestions.map((q) => (
                    <Chip key={q} size="sm" disabled={busy || !aggregates} onClick={() => ask(q)}>
                        {q}
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
                <button type="submit" aria-label={t('chat.send')} disabled={busy || !text.trim() || !aggregates} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-forest text-white disabled:opacity-40">
                    <ArrowUp size={20} aria-hidden="true" />
                </button>
            </form>
            {thread.length > 0 ? (
                <button type="button" onClick={() => setThread([])} className="h-11 self-start rounded-xl px-2 text-[13px] font-semibold text-ink-muted">
                    {t('chat.clear')}
                </button>
            ) : null}
        </section>
    );
}
