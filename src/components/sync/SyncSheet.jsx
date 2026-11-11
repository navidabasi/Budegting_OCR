import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Sheet } from '../ui';
import RecordSyncBadge from './RecordSyncBadge';
import { STATE } from '../../data/syncState';
import { useSyncQueue } from '../../data/syncHooks';
import { useTransactions } from '../../data/hooks';
import { discardEntry, resolveConflict, retryEntry } from '../../data/sync';
import { discardImage, retryImage } from '../../data/images';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';

const btn = 'inline-flex h-11 min-w-[44px] items-center justify-center rounded-[14px] border border-line-strong bg-surface px-3.5 text-sm font-semibold text-ink active:opacity-80 disabled:opacity-50';

/** Sync details: state, "Retry now", and the "Needs attention" list (failed changes, failed photos, changes that lost to a newer version). */
export default function SyncSheet({ open, onClose }) {
    const { t, languageCode } = useTranslation();
    const userId = useAppStore((s) => s.currentUser?.userId);
    const showToast = useAppStore((s) => s.showToast);
    const { outbox, images, conflicts, summary, online, syncing, lastSyncAt, retryNow } = useSyncQueue();
    const { transactions } = useTransactions();
    const [busy, setBusy] = useState(false);

    const name = (table, id) => {
        const tx = table === 'transactions' ? transactions.find((x) => x.id === id) : null;
        return [t(`sync.table.${table}`), tx?.merchant].filter(Boolean).join(' · ');
    };
    const failedOps = outbox.filter((e) => e.status === 'failed');
    const failedImages = images.filter((i) => i.status === 'failed');
    const when = lastSyncAt ? new Intl.DateTimeFormat(languageCode, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(lastSyncAt)) : null;

    const run = async (fn) => {
        setBusy(true);
        try {
            await fn();
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet open={open} onClose={onClose} label={t('sync.title')}>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-2" data-testid="sync-sheet">
                <h2 className="font-display text-xl font-bold text-ink">{t('sync.title')}</h2>
                <div className="flex items-center justify-between gap-3">
                    <RecordSyncBadge state={summary.state} size={14} />
                    <span className="text-xs text-ink-muted">{when ? t('sync.lastSync', { time: when }) : t('sync.neverSynced')}</span>
                </div>
                {!online ? <p className="rounded-[14px] bg-warn-soft px-3.5 py-3 text-sm text-warn-ink">{t('sync.offlineNote')}</p> : null}
                {summary.pending > 0 ? <p className="text-sm text-ink-muted">{t('sync.waitingCount', { count: summary.pending })}</p> : null}
                {summary.state === STATE.SYNCED && online ? <p className="text-sm text-ink-muted">{t('sync.allSynced')}</p> : null}

                <button type="button" disabled={busy || syncing || !online} onClick={() => run(retryNow)} className="flex h-12 items-center justify-center gap-2 rounded-[16px] bg-forest text-base font-semibold text-white disabled:opacity-50">
                    <RefreshCw size={18} className={busy || syncing ? 'animate-spin' : ''} aria-hidden="true" />
                    {busy || syncing ? t('sync.retrying') : t('sync.retryNow')}
                </button>

                {failedOps.length + failedImages.length > 0 ? (
                    <section className="flex flex-col gap-2" aria-label={t('sync.attention.title')}>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-over-ink">{t('sync.attention.title')}</h3>
                        <p className="text-sm text-ink-muted">{t('sync.attention.hint')}</p>
                        {failedOps.map((e) => (
                            <div key={e.seq} className="flex flex-col gap-2 rounded-[14px] border border-line-strong bg-surface px-3.5 py-3" data-testid="attention-entry">
                                <div className="flex flex-col">
                                    <span className="text-[15px] font-medium text-ink">{t(`sync.op.${e.op}`)} · {name(e.table, e.recordId)}</span>
                                    {e.lastError ? <span className="break-words text-xs text-over-ink">{e.lastError}</span> : null}
                                </div>
                                <div className="flex gap-2">
                                    <button type="button" className={btn} disabled={busy} onClick={() => run(() => retryEntry(e.seq, userId))}>
                                        {t('sync.retry')}
                                    </button>
                                    <button
                                        type="button"
                                        className={btn}
                                        disabled={busy}
                                        onClick={() =>
                                            run(async () => {
                                                await discardEntry(e.seq);
                                                showToast(t('sync.discarded'), 'info');
                                            })
                                        }
                                    >
                                        {t('sync.discard')}
                                    </button>
                                </div>
                            </div>
                        ))}
                        {failedImages.map((im) => (
                            <div key={im.id} className="flex flex-col gap-2 rounded-[14px] border border-line-strong bg-surface px-3.5 py-3" data-testid="attention-image">
                                <div className="flex flex-col">
                                    <span className="text-[15px] font-medium text-ink">{t('sync.photoUpload')}</span>
                                    {im.lastError ? <span className="break-words text-xs text-over-ink">{im.lastError}</span> : null}
                                </div>
                                <div className="flex gap-2">
                                    <button type="button" className={btn} disabled={busy} onClick={() => run(() => retryImage(im.id, userId))}>
                                        {t('sync.retry')}
                                    </button>
                                    <button type="button" className={btn} disabled={busy} onClick={() => run(() => discardImage(im.id))}>
                                        {t('sync.discard')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </section>
                ) : null}

                {conflicts.length > 0 ? (
                    <section className="flex flex-col gap-2" aria-label={t('sync.conflict.title')}>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('sync.conflict.title')}</h3>
                        {conflicts.map((c) => (
                            <div key={c.id} className="flex flex-col gap-2 rounded-[14px] border border-line-strong bg-surface px-3.5 py-3" data-testid="conflict-entry">
                                <span className="text-sm text-ink">{t('sync.conflict.body', { what: name(c.table, c.recordId) })}</span>
                                <div className="flex gap-2">
                                    {c.local && c.op !== 'delete' && c.op !== 'insert' ? (
                                        <button type="button" className={btn} disabled={busy} onClick={() => run(() => resolveConflict(userId, c.id, 'mine'))}>
                                            {t('sync.conflict.mine')}
                                        </button>
                                    ) : null}
                                    <button type="button" className={btn} disabled={busy} onClick={() => run(() => resolveConflict(userId, c.id, 'server'))}>
                                        {t('sync.conflict.dismiss')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </section>
                ) : null}
            </div>
        </Sheet>
    );
}
