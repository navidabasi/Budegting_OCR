import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowUpRight } from 'lucide-react';
import { Chip } from '../ui';
import EvidenceAnswer from './EvidenceAnswer';
import ProposalSheet from './ProposalSheet';
import AiHistory from './AiHistory';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { useKeyboardOpen } from '../../hooks/useKeyboardOpen';
import { getAccessToken } from '../../services/accessToken';
import { actionHref, loadThread, saveThread, sendEvidenceChat, STORAGE_KEY } from '../../services/chatApi';
import { packMeta, unpackMessage } from '../../services/chatMeta';
import { useKeepChatHistory, useOpenConversation } from '../../services/chatPrefs';
import { useChatActions, useConversation, useConversationMessages } from '../../data/hooks';
import { useAppStore } from '../../store/appStore';
import { captureAnchor, restoreAnchor } from '../../utils/scrollAnchor';
import { chatTitle } from '../../data/repo';
import { buildEvidencePack, routeQuestion } from '../../services/evidencePack';
import { localProposals, resolveProposals } from '../../services/aiActions';
import { restoreAliases } from '../../services/aiOutbound';

const CHIPS = ['top_merchant', 'grocery_breakdown', 'change', 'unit_price', 'owed', 'review', 'budgets_goals'];

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
    const userId = useAppStore((state) => state.currentUser?.userId || null);
    const showToast = useAppStore((state) => state.showToast);
    const [keep] = useKeepChatHistory();
    const persist = keep && !!userId; // off (or signed out): the thread lives for this session only, as before
    const [openId, setOpenId] = useOpenConversation(userId);
    const [session, setSession] = useState(() => (persist ? [] : loadThread()));
    const stored = useConversationMessages(persist ? openId : null);
    const { conversation, loaded: convLoaded } = useConversation(persist ? openId : null);
    const chat = useChatActions();
    const thread = useMemo(() => (persist ? stored.messages.map(unpackMessage) : session), [persist, stored.messages, session]);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [proposal, setProposal] = useState(null);
    const [historyKey, setHistoryKey] = useState(0);
    const endRef = useRef(null);
    const itemRefs = useRef(new Map());
    const anchorRef = useRef(null);
    const scrolledFor = useRef(null);
    const lastKey = useRef(null);
    const [armed, setArmed] = useState(false);
    const guard = useRef(false); // synchronous: two taps in one frame send one question
    const migrated = useRef(false);
    const ready = !!ctx && ctx.transactions;

    // Session-only mode keeps the thread in sessionStorage like before
    useEffect(() => {
        if (!persist) saveThread(session);
    }, [persist, session]);

    // A thread left in sessionStorage by the previous version becomes a conversation, once; the key is removed afterwards
    useEffect(() => {
        if (!persist || migrated.current) return;
        migrated.current = true;
        const old = loadThread();
        if (old.length === 0) {
            try {
                sessionStorage.removeItem(STORAGE_KEY);
            } catch {
                /* nothing to clean */
            }
            return;
        }
        (async () => {
            try {
                const first = old.find((m) => m.role === 'user');
                const conv = await chat.createConversation({ title: first?.content || '' });
                for (const m of old) await chat.appendMessage({ conversationId: conv.id, role: m.role, content: m.content, meta: packMeta(m) });
                setOpenId(conv.id);
                sessionStorage.removeItem(STORAGE_KEY);
            } catch (err) {
                console.error('[chat] could not move the session thread into the history', err);
                migrated.current = false; // try again next time; the session copy is still there
            }
        })();
    }, [persist]); // eslint-disable-line react-hooks/exhaustive-deps

    // The remembered conversation was deleted (here or on another device): start fresh
    useEffect(() => {
        if (persist && openId && convLoaded && !conversation) setOpenId(null);
    }, [persist, openId, convLoaded, conversation, setOpenId]);

    // Older messages come in above the visible ones: keep the reading position exactly
    useLayoutEffect(() => {
        const a = anchorRef.current;
        if (!a || thread[0]?.id === a.firstId) return;
        restoreAnchor(a, itemRefs.current.get(a.key));
        anchorRef.current = null;
    }, [thread]);
    // Open at the newest message; follow new ones at the bottom
    useEffect(() => {
        if (anchorRef.current || thread.length === 0) return;
        const convKey = persist ? openId : 'session';
        const last = thread[thread.length - 1].id ?? thread.length;
        if (scrolledFor.current !== convKey) {
            scrolledFor.current = convKey;
            endRef.current?.scrollIntoView?.({ block: 'end' });
            const timer = setTimeout(() => setArmed(true), 400);
            lastKey.current = last;
            return () => clearTimeout(timer);
        }
        if (lastKey.current !== last || busy) endRef.current?.scrollIntoView?.({ block: 'nearest' });
        lastKey.current = last;
        return undefined;
    }, [thread, busy, persist, openId]);

    const loadOlder = useCallback(async () => {
        if (!stored.hasOlder || stored.loadingOlder) return;
        const items = thread.map((m) => ({ key: m.id, el: itemRefs.current.get(m.id) }));
        const a = captureAnchor(items, 0);
        anchorRef.current = a ? { ...a, firstId: thread[0]?.id } : null;
        await stored.loadOlder();
    }, [stored, thread]);
    const topRef = useRef(null);
    useEffect(() => {
        const el = topRef.current;
        if (!armed || !el || !stored.hasOlder || typeof IntersectionObserver === 'undefined') return undefined;
        const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadOlder(), { rootMargin: '200px 0px 0px 0px' });
        io.observe(el);
        return () => io.disconnect();
    }, [armed, stored.hasOlder, loadOlder]);


    const errorKey = (err) => (['offline', 'rateLimit', 'notConfigured', 'auth'].includes(err?.kind) ? err.kind : 'server');

    // Write one message: into the open conversation (created on the first question) or, in session mode, into memory
    const post = async (convRef, m) => {
        if (!persist) {
            setSession((cur) => [...cur, m]);
            return;
        }
        try {
            if (!convRef.id) convRef.id = (await chat.createConversation({ title: chatTitle(m.content) })).id;
            await chat.appendMessage({ conversationId: convRef.id, role: m.role, content: m.content, meta: packMeta(m) });
            if (convRef.id !== openId) setOpenId(convRef.id);
        } catch (err) {
            console.error('[chat] could not save a message', err);
            showToast?.(t('chat.saveFailed'), 'error');
        }
    };

    /** `retryOf`: the question is already in the thread (its answer failed): only a new answer is added after the error. */
    const ask = async (question, { intent, retryOf = false } = {}) => {
        const q = question.trim();
        if (!q || guard.current || !ready) return;
        guard.current = true;
        const convRef = { id: persist ? openId : null };
        const userMsg = { role: 'user', content: q };
        const next = retryOf ? thread : [...thread, userMsg];
        setText('');
        setBusy(true);
        try {
            if (!retryOf) await post(convRef, userMsg);
            const route = intent || routeQuestion(q);
            const { pack, refs } = buildEvidencePack({ ...ctx, intent: route, question: q });
            const locals = route === 'review' ? localProposals(ctx.transactions, { period: ctx.period, today: ctx.today, suggest: ctx.suggest, categories: ctx.categoryNames }) : [];
            if (pack.insufficient) {
                // nothing to explain: answered here, no request is made
                await post(convRef, { role: 'assistant', content: t(`evidence.insufficient.${pack.insufficient}`), ev: { pack, refs, citations: [], uncertain: [], grounded: true, unsupported: [], proposals: pack.insufficient === 'nothing_to_review' ? [] : locals, state: 'insufficient' } });
                return;
            }
            try {
                const out = await sendEvidenceChat({ pack, thread: next, language, getToken, fetchImpl });
                const resolved = resolveProposals(out.proposals, refs, ctx.transactions, { categories: ctx.categoryNames || [] });
                const proposals = [...resolved, ...locals.filter((l) => !resolved.some((r) => r.type === l.type && JSON.stringify(r.records || r.remove) === JSON.stringify(l.records || l.remove)))];
                await post(convRef, { role: 'assistant', content: restoreAliases(out.answer), ...(out.suggestedAction ? { action: out.suggestedAction } : {}), ev: { pack, refs, citations: out.citations, uncertain: out.uncertain, grounded: out.grounded, unsupported: out.unsupported, proposals, state: 'ok' } });
            } catch (err) {
                // the facts were computed here, so they are still worth showing when the explanation fails
                await post(convRef, { role: 'assistant', content: t(`chat.error.${errorKey(err)}`), error: true, retry: q, intent: route, ev: { pack, refs, citations: [], uncertain: [], grounded: true, unsupported: [], proposals: locals, state: err?.kind === 'offline' ? 'offline' : 'failed' } });
            }
        } finally {
            guard.current = false;
            setBusy(false);
        }
    };
    const retry = (m) => ask(m.retry, { intent: m.intent, retryOf: true });
    const newChat = () => {
        if (persist) setOpenId(null);
        else setSession([]);
        setText('');
        scrolledFor.current = null;
    };

    const suggestions = useMemo(() => [...CHIPS.map((i) => ({ intent: i, label: t(`evidence.chip.${i}`) })), ...extraQuestions.slice(0, 2).map((q) => ({ intent: undefined, label: q }))], [extraQuestions, t]); // eslint-disable-line react-hooks/exhaustive-deps
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
                    {persist && stored.hasOlder ? (
                        <li ref={topRef} className="flex justify-center">
                            <button type="button" onClick={loadOlder} disabled={stored.loadingOlder} className="h-11 rounded-xl px-3 text-[13px] font-semibold text-forest-ink disabled:opacity-60" data-testid="chat-earlier">
                                {stored.loadingOlder ? t('chat.loadingEarlier') : t('chat.earlier')}
                            </button>
                        </li>
                    ) : null}
                    {thread.map((m, i) => (
                        <li
                            key={m.id ?? i}
                            ref={(el) => {
                                if (m.id == null) return;
                                if (el) itemRefs.current.set(m.id, el);
                                else itemRefs.current.delete(m.id);
                            }}
                            className={`flex flex-col gap-1.5 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <p className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-snug ${m.role === 'user' ? 'bg-ink text-ground dark:bg-forest dark:text-white' : m.error ? 'bg-warn-soft text-warn-ink' : 'bg-surface text-ink shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line'}`}>{m.content}</p>
                            {m.role === 'assistant' && m.ev ? <EvidenceAnswer ev={m.ev} onProposal={setProposal} /> : null}
                            {m.error && m.retry && i === thread.length - 1 && !busy && m.content !== t('chat.error.rateLimit') ? (
                                <button type="button" onClick={() => retry(m)} className="h-11 rounded-xl px-3 text-sm font-semibold text-forest-ink">
                                    {t('insights.retry')}
                                </button>
                            ) : null}
                            {m.action && actionHref(m.action, month, m.ev?.pack?.period) ? (
                                <Link to={actionHref(m.action, month, m.ev?.pack?.period)} className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-forest-ink bg-surface px-3.5 text-sm font-semibold text-forest-ink">
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
                <button type="button" onClick={newChat} className="h-11 self-start rounded-xl px-2 text-[13px] font-semibold text-ink-muted" data-testid="chat-new">
                    {t('chat.newChat')}
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
