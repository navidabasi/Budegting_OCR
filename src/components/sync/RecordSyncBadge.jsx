import { AlertTriangle, Check, CloudOff, Smartphone } from 'lucide-react';
import { STATE } from '../../data/syncState';
import { useTranslation } from '../../languages/useTranslation';

const LOOK = {
    [STATE.SAVED_LOCAL]: { Icon: Smartphone, tone: 'text-ink-muted', key: 'sync.state.savedLocal' },
    [STATE.WAITING]: { Icon: CloudOff, tone: 'text-warn-ink', key: 'sync.state.waiting' },
    [STATE.SYNCED]: { Icon: Check, tone: 'text-ink-faint', key: 'sync.state.synced' },
    [STATE.ATTENTION]: { Icon: AlertTriangle, tone: 'text-over-ink', key: 'sync.state.attention' },
};

/** Per-record sync state. `compact` = icon only (list rows, text in the accessible name); otherwise icon + label. */
export default function RecordSyncBadge({ state, compact = false, size = 12, className = '' }) {
    const { t } = useTranslation();
    const look = LOOK[state] || LOOK[STATE.SYNCED];
    const { Icon } = look;
    const label = t(look.key);
    if (compact) return <Icon size={size} className={`shrink-0 ${look.tone} ${className}`} role="img" aria-label={label} data-sync-state={state} />;
    return (
        <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${look.tone} ${className}`} data-sync-state={state}>
            <Icon size={size + 2} aria-hidden="true" />
            {label}
        </span>
    );
}
