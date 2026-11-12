import { Check, ShieldCheck, X } from 'lucide-react';
import AiLockedNotice from '../common/AiLockedNotice';
import { useAiAccess, useAiAccessAdmin } from '../../hooks/useAiAccess';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';

const CHIP = {
    pending: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
    approved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200',
    denied: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    admin: 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200',
};

/**
 * Settings > AI & scanning > AI access. Everyone sees whether AI features are on for their account. The admin (the owner) also
 * sees every account, waiting ones first, with today's AI calls, and approves, denies or revokes them. The server enforces it.
 */
export default function AiAccessSettings() {
    const { t } = useTranslation();
    const access = useAiAccess();
    const admin = useAiAccessAdmin(access.isAdmin);
    const showToast = useAppStore((s) => s.showToast);
    if (!access.known) return null;

    const decide = async (userId, status) => {
        try {
            await admin.decide({ userId, status });
            showToast?.(t(`aiAccess.done.${status}`), 'success');
        } catch {
            showToast?.(t('aiAccess.decideFailed'), 'error');
        }
    };
    const button = (label, onClick, tone, Icon, disabled) => (
        <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-semibold disabled:opacity-50 ${tone}`}>
            <Icon size={16} aria-hidden="true" />
            {label}
        </button>
    );

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
                <section className="flex flex-col gap-1" aria-label={t('aiAccess.accounts')} data-testid="ai-access-admin">
                    <h4 className="pt-1 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">{t('aiAccess.accounts')}</h4>
                    {admin.error ? <p className="text-sm text-red-600 dark:text-red-400">{t('aiAccess.loadFailed')}</p> : null}
                    {!admin.loading && !admin.error && admin.accounts.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-400">{t('aiAccess.noAccounts')}</p> : null}
                    <ul className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700">
                        {admin.accounts.map((a) => {
                            const chip = a.isAdmin ? 'admin' : a.status;
                            const busy = admin.deciding === a.userId;
                            return (
                                <li key={a.userId} className="flex flex-col gap-1.5 py-2.5" data-testid="ai-access-row" data-status={chip}>
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-white">{a.email || a.userId}</span>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP[chip]}`}>{t(`aiAccess.state.${chip}`)}</span>
                                    </div>
                                    <p className="text-xs text-gray-600 dark:text-gray-400">{t('aiAccess.callsToday', { count: a.callsToday })}</p>
                                    {a.isAdmin ? null : (
                                        <div className="flex flex-wrap gap-2">
                                            {a.status !== 'approved' ? button(t('aiAccess.approve'), () => decide(a.userId, 'approved'), 'bg-emerald-600 text-white dark:bg-emerald-500', Check, busy) : null}
                                            {a.status === 'pending' ? button(t('aiAccess.deny'), () => decide(a.userId, 'denied'), 'border border-gray-300 text-gray-900 dark:border-gray-600 dark:text-white', X, busy) : null}
                                            {a.status === 'approved' ? button(t('aiAccess.revoke'), () => decide(a.userId, 'denied'), 'border border-gray-300 text-gray-900 dark:border-gray-600 dark:text-white', X, busy) : null}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ) : null}
        </div>
    );
}
