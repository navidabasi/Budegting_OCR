import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, History } from 'lucide-react';
import { loadLog, undoEntry } from '../../services/aiActions';
import { useTranslation } from '../../languages/useTranslation';
import { useAppStore } from '../../store/appStore';
import { notifyDataChanged } from '../../data/queryClient';

/** Changes applied from assistant proposals, newest first, with Undo. Survives restarts (local store). Collapses. */
export default function AiHistory({ refreshKey }) {
    const { t, languageCode } = useTranslation();
    const userId = useAppStore((s) => s.currentUser?.userId);
    const showToast = useAppStore((s) => s.showToast);
    const [log, setLog] = useState([]);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(null);
    const reload = useCallback(() => loadLog(userId).then(setLog), [userId]);
    useEffect(() => {
        reload();
    }, [reload, refreshKey]);
    if (log.length === 0) return null;
    const when = (iso) => new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
    const label = (e) => {
        const text = t(`evidence.history.entry.${e.type}`, { count: e.count, category: e.category, frequency: e.frequency ? t(`evidence.freq.${e.frequency}`) : '' });
        return e.label ? `${text} (${e.label})` : text;
    };
    const undo = async (e) => {
        if (busy) return;
        setBusy(e.id);
        try {
            await undoEntry(userId, e.id);
            notifyDataChanged();
            await reload();
        } catch (err) {
            console.error('[assistant] undo failed', err);
            showToast(t('evidence.history.undoFailed'), 'error');
        } finally {
            setBusy(null);
        }
    };
    return (
        <section className="flex flex-col" aria-label={t('evidence.history.title')} data-testid="ai-history">
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-[44px] items-center justify-between gap-2 text-start text-[13px] font-semibold text-ink-muted">
                <span className="flex items-center gap-1.5">
                    <History size={15} aria-hidden="true" />
                    {t('evidence.history.title')} ({log.length})
                </span>
                <ChevronDown size={15} className={open ? 'rotate-180' : ''} aria-hidden="true" />
            </button>
            {open ? (
                <ul className="flex flex-col divide-y divide-line rounded-2xl bg-surface px-3.5">
                    {log.slice(0, 8).map((e) => (
                        <li key={e.id} className="flex min-h-[52px] items-center gap-2 py-2 text-sm" data-testid="history-entry" data-status={e.status}>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-ink">{label(e)}</span>
                                <span className="text-xs text-ink-muted">{when(e.at)}</span>
                            </span>
                            {e.status === 'applied' ? (
                                <button type="button" onClick={() => undo(e)} disabled={busy === e.id} className="h-11 shrink-0 rounded-xl border border-line-strong px-3 text-sm font-semibold text-forest-ink">
                                    {t('evidence.history.undo')}
                                </button>
                            ) : (
                                <span className="shrink-0 text-xs font-semibold text-ink-muted">{t('evidence.history.undone')}</span>
                            )}
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}
