import { Camera, PenLine, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { useDemoData } from '../../data/hooks';
import { useTranslation } from '../../languages/useTranslation';

/** New user, no transactions yet: three ways to start. */
export default function EmptyHome() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const openQuickAdd = useAppStore((s) => s.openQuickAdd);
    const showToast = useAppStore((s) => s.showToast);
    const { seedDemoData } = useDemoData();
    const btn = 'flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold';
    return (
        <section className="flex flex-col items-center gap-4 rounded-3xl bg-surface px-5 py-8 text-center shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line" data-testid="empty-home">
            <h2 className="font-display text-2xl font-bold text-ink">{t('home.emptyTitle')}</h2>
            <p className="max-w-xs text-sm text-ink-muted">{t('home.emptyBody')}</p>
            <button type="button" onClick={() => navigate('/scan?source=camera')} className={`${btn} bg-forest text-white`}>
                <Camera size={20} aria-hidden="true" />
                {t('home.scan')}
            </button>
            <button type="button" onClick={() => openQuickAdd()} className={`${btn} border border-line-strong bg-surface text-ink`}>
                <PenLine size={20} aria-hidden="true" />
                {t('home.addManually')}
            </button>
            <button type="button" onClick={() => seedDemoData().catch(() => showToast(t('quickAdd.saveFailed'), 'error'))} className="flex h-12 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-forest-ink">
                <Sparkles size={16} aria-hidden="true" />
                {t('home.trySample')}
            </button>
        </section>
    );
}
