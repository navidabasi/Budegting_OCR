import { CheckCircle, XCircle, Info, AlertCircle, X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';

const ICONS = {
    success: <CheckCircle className="text-income" size={20} aria-hidden="true" />,
    error: <XCircle className="text-over" size={20} aria-hidden="true" />,
    warning: <AlertCircle className="text-warn" size={20} aria-hidden="true" />,
    info: <Info className="text-savings" size={20} aria-hidden="true" />,
};

/** Snackbar above the bottom nav (thumb zone). Supports one action button (e.g. Undo). */
export default function Toast() {
    const { t } = useTranslation();
    const toast = useAppStore((state) => state.toast);
    const showToast = useAppStore((state) => state.showToast);

    if (!toast) return null;

    return (
        <div className="toast-container pointer-events-none fixed inset-x-0 bottom-28 z-[70] flex justify-center px-4 animate-fade-in">
            <div
                role="status"
                aria-live="polite"
                className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-line bg-surface py-2 ps-4 pe-2 text-ink shadow-lg"
            >
                {ICONS[toast.type] || ICONS.info}
                <p className="min-w-0 flex-1 text-sm">{toast.message}</p>
                {toast.action ? (
                    <button
                        type="button"
                        onClick={() => {
                            const action = toast.action;
                            showToast(null);
                            action.onClick?.();
                        }}
                        className="h-11 min-w-[44px] rounded-xl px-3 text-sm font-semibold text-forest-ink"
                    >
                        {toast.action.label}
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={() => showToast(null)}
                    aria-label={t('ds.close')}
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-muted"
                >
                    <X size={16} aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
