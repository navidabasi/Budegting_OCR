import { useState } from 'react';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import AiLockedNotice from '../common/AiLockedNotice';
import AiAccessSheet from './AiAccessSheet';
import { useAiAccess, useAiAccessAdmin } from '../../hooks/useAiAccess';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';

/**
 * Settings > AI & scanning > AI access. Everyone sees whether AI features are on for their account. The admin sees the queue in one
 * line (how many wait, how many are approved or denied) and reviews them in a sheet built for long lists (AiAccessSheet).
 */
export default function AiAccessSettings() {
    const { t } = useTranslation();
    const access = useAiAccess();
    const admin = useAiAccessAdmin(access.isAdmin);
    const showToast = useAppStore((s) => s.showToast);
    const [open, setOpen] = useState(false);
    if (!access.known) return null;

    const others = admin.accounts.filter((a) => !a.isAdmin);
    const waiting = others.filter((a) => a.status === 'pending').length;
    const approved = others.filter((a) => a.status === 'approved').length;
    const denied = others.filter((a) => a.status === 'denied').length;
    const onResult = ({ done, failed }, status) => {
        if (failed) showToast?.(t('aiAccess.partial', { done, failed }), 'error');
        else if (done === 1) showToast?.(t(`aiAccess.done.${status}`), 'success');
        else showToast?.(t('aiAccess.done.many', { count: done }), 'success');
    };

    return (
        <div className="mb-3 flex flex-col gap-2 border-b border-gray-100 pb-3 dark:border-gray-700" data-testid="ai-access-settings">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('aiAccess.title')}</h3>
            {access.allowed ? (
                <p className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                    <ShieldCheck size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    {t(access.isAdmin ? 'aiAccess.statusAdmin' : 'aiAccess.statusApproved')}
                </p>
            ) : (
                <AiLockedNotice status={access.status} />
            )}
            {access.isAdmin ? (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    disabled={admin.loading}
                    className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-start disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900/40"
                    data-testid="ai-access-admin"
                >
                    <span className={`flex h-10 min-w-[40px] items-center justify-center rounded-xl px-2 font-display text-lg font-bold tabular-nums ${waiting ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`} data-testid="ai-access-waiting">
                        {admin.loading ? '…' : waiting}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{admin.error ? t('aiAccess.loadFailed') : waiting ? t('aiAccess.queue.waiting', { count: waiting }) : t('aiAccess.queue.none')}</span>
                        <span className="text-xs text-gray-600 dark:text-gray-400">{t('aiAccess.queue.summary', { approved, denied })}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-primary-600 dark:text-primary-400">
                        {waiting ? t('aiAccess.review') : t('aiAccess.manage')}
                        <ChevronRight size={16} className="rtl:rotate-180" aria-hidden="true" />
                    </span>
                </button>
            ) : null}
            {access.isAdmin ? <AiAccessSheet open={open} onClose={() => setOpen(false)} accounts={admin.accounts} decide={admin.decide} busyIds={admin.busyIds} onResult={onResult} /> : null}
        </div>
    );
}
