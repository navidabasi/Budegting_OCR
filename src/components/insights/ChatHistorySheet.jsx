import { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { Sheet } from '../ui';
import DeleteAllChatSheet from './DeleteAllChatSheet';
import { useTranslation } from '../../languages/useTranslation';
import { useAppStore } from '../../store/appStore';
import { useChatActions, useConversations } from '../../data/hooks';
import { useOpenConversation } from '../../services/chatPrefs';

const SWIPE_PX = 80;

/** A row that can be swiped sideways to delete (the delete button next to it is the accessible path). */
function SwipeRow({ onSwipe, children }) {
    const start = useRef(null);
    const [dx, setDx] = useState(0);
    const onDown = (e) => {
        if (e.pointerType === 'mouse') return; // desktop uses the button
        start.current = { x: e.clientX, y: e.clientY, locked: false };
    };
    const onMove = (e) => {
        const s = start.current;
        if (!s) return;
        const mx = e.clientX - s.x;
        if (!s.locked && Math.abs(e.clientY - s.y) > 12 && Math.abs(e.clientY - s.y) > Math.abs(mx)) {
            start.current = null; // a vertical scroll, not a swipe
            return;
        }
        if (Math.abs(mx) > 8) s.locked = true;
        if (s.locked) setDx(mx);
    };
    const end = () => {
        const moved = dx;
        start.current = null;
        setDx(0);
        if (Math.abs(moved) >= SWIPE_PX) onSwipe();
    };
    return (
        <div className="grid overflow-hidden rounded-2xl" style={{ touchAction: 'pan-y' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={end} onPointerCancel={() => { start.current = null; setDx(0); }} data-testid="chat-row">
            <div className="flex items-center justify-end bg-over px-4 text-white" style={{ gridArea: '1 / 1' }} aria-hidden="true">
                <Trash2 size={18} />
            </div>
            <div className="bg-surface" style={{ gridArea: '1 / 1', transform: dx ? `translateX(${dx}px)` : undefined }}>
                {children}
            </div>
        </div>
    );
}

/**
 * Saved assistant chats, newest first, 20 at a time: more load near the end of the list (IntersectionObserver) or with the
 * "Load more" button. Tap opens a chat, the trash button or a swipe deletes it (undo in the toast), "New chat" starts one.
 */
export default function ChatHistorySheet({ open, onClose }) {
    const { t, languageCode } = useTranslation();
    const userId = useAppStore((s) => s.currentUser?.userId);
    const showToast = useAppStore((s) => s.showToast);
    const { conversations, loading, hasMore, loadingMore, loadMore } = useConversations();
    const [openId, setOpenId] = useOpenConversation(userId);
    const { deleteConversation, restoreConversation } = useChatActions();
    const [confirmAll, setConfirmAll] = useState(false);
    const endRef = useRef(null);
    const listRef = useRef(null);

    useEffect(() => {
        const el = endRef.current;
        if (!open || !el || !hasMore || typeof IntersectionObserver === 'undefined') return undefined;
        const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { root: listRef.current, rootMargin: '0px 0px 120px 0px' });
        io.observe(el);
        return () => io.disconnect();
    }, [open, hasMore, loadMore, conversations.length]);

    const dateLabel = (iso) => (iso ? new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '');
    const count = (n) => (n === 1 ? t('chat.messages1') : t('chat.messages', { count: n }));
    const title = (c) => c.title || t('chat.untitled');

    const openChat = (c) => {
        setOpenId(c.id);
        onClose();
    };
    const newChat = () => {
        setOpenId(null);
        onClose();
    };
    const remove = async (c) => {
        try {
            await deleteConversation(c.id);
            if (openId === c.id) setOpenId(null);
            showToast(t('chat.deleted'), 'info', {
                action: {
                    label: t('evidence.history.undo'),
                    onClick: () => restoreConversation(c.id).catch(() => showToast(t('chat.undoFailed'), 'error')),
                },
            });
        } catch (err) {
            console.error('[chat] delete failed', err);
            showToast(t('chat.deleteFailed'), 'error');
        }
    };

    return (
        <>
            <Sheet open={open} onClose={onClose} label={t('chat.historyTitle')}>
                <div className="flex min-h-0 flex-col gap-3 px-5 pb-2">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="font-display text-xl font-bold text-ink">{t('chat.historyTitle')}</h2>
                        <button type="button" onClick={newChat} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3.5 text-[13px] font-semibold text-forest-ink" data-testid="chat-history-new">
                            <MessageSquarePlus size={15} aria-hidden="true" />
                            {t('chat.newChat')}
                        </button>
                    </div>
                    <div ref={listRef} className="flex max-h-[56dvh] min-h-[120px] flex-col gap-2 overflow-y-auto overscroll-contain" data-testid="chat-history-list">
                        {!loading && conversations.length === 0 ? <p className="py-6 text-center text-sm text-ink-muted">{t('chat.historyEmpty')}</p> : null}
                        {conversations.map((c) => (
                            <SwipeRow key={c.id} onSwipe={() => remove(c)}>
                                <div className={`flex items-stretch gap-1 border ${c.id === openId ? 'border-forest-ink' : 'border-line'} rounded-2xl`}>
                                    <button type="button" onClick={() => openChat(c)} aria-current={c.id === openId ? 'true' : undefined} className="flex min-h-[56px] min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-2xl px-3.5 py-2 text-start" data-testid="chat-history-item">
                                        <span className="truncate text-sm font-semibold text-ink">{title(c)}</span>
                                        <span className="text-xs text-ink-muted">{dateLabel(c.updatedAt)} · {count(c.messageCount || 0)}</span>
                                    </button>
                                    <button type="button" onClick={() => remove(c)} aria-label={t('chat.deleteChat', { title: title(c) })} className="flex h-auto min-h-[56px] w-11 shrink-0 items-center justify-center rounded-2xl text-ink-muted" data-testid="chat-history-delete">
                                        <Trash2 size={18} aria-hidden="true" />
                                    </button>
                                </div>
                            </SwipeRow>
                        ))}
                        {loadingMore ? <p className="py-2 text-center text-xs text-ink-muted" role="status">{t('chat.loadingMore')}</p> : null}
                        {hasMore ? (
                            <div ref={endRef} className="flex justify-center">
                                <button type="button" onClick={loadMore} disabled={loadingMore} className="h-11 rounded-xl px-4 text-[13px] font-semibold text-forest-ink disabled:opacity-60" data-testid="chat-history-more">
                                    {t('chat.loadMore')}
                                </button>
                            </div>
                        ) : null}
                    </div>
                    {conversations.length > 0 ? (
                        <button type="button" onClick={() => setConfirmAll(true)} className="h-11 self-start rounded-xl px-2 text-[13px] font-semibold text-over-ink" data-testid="chat-history-delete-all">
                            {t('chat.deleteAll')}
                        </button>
                    ) : null}
                </div>
            </Sheet>
            <DeleteAllChatSheet open={confirmAll} onClose={() => setConfirmAll(false)} />
        </>
    );
}
