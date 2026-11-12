import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { APP_VERSION, BUILD_TIME, updateHandle } from '../../services/swUpdate';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';

/** Settings > About: which build this device runs, and a button to look for a newer one now (the app also does it by itself). */
export default function AppVersion() {
    const { t, languageCode } = useTranslation();
    const showToast = useAppStore((s) => s.showToast);
    const [busy, setBusy] = useState(false);
    const built = BUILD_TIME ? new Intl.DateTimeFormat(`${languageCode}-u-nu-latn`, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(BUILD_TIME)) : null;

    const check = async () => {
        const handle = updateHandle();
        setBusy(true);
        try {
            if (!handle) {
                window.location.reload();
                return;
            }
            const result = await handle.checkNow();
            if (result === 'latest') showToast?.(t('appVersion.latest'), 'success');
            else if (result === 'failed') showToast?.(t('appVersion.failed'), 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="app-version">
            <p className="text-xs text-gray-600 dark:text-gray-400">{t('appVersion.label', { version: APP_VERSION, built: built || '—' })}</p>
            <button type="button" onClick={check} disabled={busy} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-primary-600 disabled:opacity-60 dark:text-primary-400" data-testid="check-updates">
                <RefreshCw size={15} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
                {busy ? t('appVersion.checking') : t('appVersion.check')}
            </button>
        </div>
    );
}
