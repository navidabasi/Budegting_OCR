import { Lock } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

/**
 * Shown where an AI feature would be when the owner has not approved AI for this account (status pending or denied).
 * Says what is off and that everything can still be done by hand. `action`: an optional button (e.g. "Add it by hand").
 */
export default function AiLockedNotice({ status = 'pending', action = null, className = '' }) {
    const { t } = useTranslation();
    const denied = status === 'denied';
    return (
        <div className={`flex items-start gap-3 rounded-[18px] bg-tint px-4 py-3.5 ${className}`} role="status" data-testid="ai-locked" data-status={status}>
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface text-ink-muted">
                <Lock size={16} aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm font-semibold text-ink">{t(denied ? 'aiAccess.deniedTitle' : 'aiAccess.pendingTitle')}</p>
                <p className="text-[13px] leading-relaxed text-ink-muted">{t(denied ? 'aiAccess.deniedBody' : 'aiAccess.pendingBody')}</p>
                {action}
            </div>
        </div>
    );
}
