import { useState } from 'react';
import { AlertTriangle, CloudOff, RefreshCw, Smartphone } from 'lucide-react';
import SyncSheet from './SyncSheet';
import { useSyncQueue } from '../../data/syncHooks';
import { useTranslation } from '../../languages/useTranslation';

/**
 * Global sync indicator. Quiet when everything is synced and online; otherwise a 44 px chip says what is going on
 * (offline, N waiting, N need attention, syncing) and opens the sync sheet with "Retry now".
 */
export default function SyncChip({ className = '' }) {
    const { t } = useTranslation();
    const { summary, online, syncing, conflicts } = useSyncQueue();
    const [open, setOpen] = useState(false);

    const attention = summary.failed + conflicts.length;
    let Icon = Smartphone;
    let tone = 'border-line-strong text-ink-muted';
    let text = null;
    if (attention > 0) {
        Icon = AlertTriangle;
        tone = 'border-warn-edge text-over-ink';
        text = t('sync.chip.attention', { count: attention });
    } else if (!online) {
        Icon = CloudOff;
        tone = 'border-warn-edge text-warn-ink';
        text = summary.pending > 0 ? t('sync.chip.offlinePending', { count: summary.pending }) : t('sync.chip.offline');
    } else if (syncing && summary.pending > 0) {
        Icon = RefreshCw;
        text = t('sync.chip.syncing');
    } else if (summary.pending > 0) {
        text = t('sync.chip.pending', { count: summary.pending });
    }
    if (!text && !open) return null;

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={`inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-full border bg-surface px-3.5 text-[13px] font-semibold active:opacity-80 ${tone} ${className}`}
                data-testid="sync-chip"
                data-sync-state={summary.state}
            >
                <Icon size={15} className={syncing && Icon === RefreshCw ? 'animate-spin' : ''} aria-hidden="true" />
                {text}
            </button>
            <SyncSheet open={open} onClose={() => setOpen(false)} />
        </>
    );
}
