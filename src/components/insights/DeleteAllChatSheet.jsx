import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Sheet } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { useAppStore } from '../../store/appStore';
import { useChatActions } from '../../data/hooks';
import { setOpenConversationId } from '../../services/chatPrefs';

/** Confirmation sheet for "Delete all chat history" (no confirm() dialogs). Used by the History sheet and Settings. */
export default function DeleteAllChatSheet({ open, onClose, onDeleted }) {
    const { t } = useTranslation();
    const userId = useAppStore((s) => s.currentUser?.userId);
    const showToast = useAppStore((s) => s.showToast);
    const { deleteAllConversations } = useChatActions();
    const [busy, setBusy] = useState(false);
    const [guard] = useState({ busy: false });

    const confirm = async () => {
        if (guard.busy) return;
        guard.busy = true;
        setBusy(true);
        try {
            await deleteAllConversations();
            setOpenConversationId(userId, null);
            showToast(t('chat.deleteAllDone'), 'success');
            onDeleted?.();
            onClose();
        } catch (err) {
            console.error('[chat] delete all failed', err);
            showToast(t('chat.deleteAllFailed'), 'error');
        } finally {
            guard.busy = false;
            setBusy(false);
        }
    };

    return (
        <Sheet open={open} onClose={onClose} label={t('chat.deleteAllTitle')}>
            <div className="flex flex-col gap-3 px-5 pb-2">
                <h2 className="font-display text-xl font-bold text-ink">{t('chat.deleteAllTitle')}</h2>
                <p className="text-sm leading-snug text-ink-muted">{t('chat.deleteAllBody')}</p>
                <button type="button" onClick={confirm} disabled={busy} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-over px-4 text-base font-semibold text-white disabled:opacity-60" data-testid="delete-all-confirm">
                    <Trash2 size={18} aria-hidden="true" />
                    {t('chat.deleteAllConfirm')}
                </button>
                <button type="button" onClick={onClose} data-autofocus className="h-12 rounded-2xl border border-line-strong bg-surface px-4 text-base font-semibold text-ink">
                    {t('common.actions.cancel')}
                </button>
            </div>
        </Sheet>
    );
}
