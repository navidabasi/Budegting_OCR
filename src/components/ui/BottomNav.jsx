import { Home, ListFilter, PieChart, Plus, Sparkles } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';

const itemClass = (active) =>
    `flex h-14 w-16 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink ${
        active ? 'text-forest-ink' : 'text-ink-muted'
    }`;

/** Five slots: Home, Activity, + FAB, Budgets, Insights. */
export default function BottomNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const setAddReceiptModalOpen = useAppStore((state) => state.setAddReceiptModalOpen);
    if (pathname.startsWith('/scan') || pathname.startsWith('/receipts/') || pathname.startsWith('/welcome') || pathname.startsWith('/trips/')) return null; // full-screen flows with their own thumb-zone actions
    const isHome = pathname === '/' || pathname === '/dashboard';

    const link = (to, icon, label, active) => {
        const Icon = icon;
        return (
            <NavLink to={to} aria-label={label} aria-current={active ? 'page' : undefined} className={itemClass(active)}>
                <Icon size={22} aria-hidden="true" />
                {label}
            </NavLink>
        );
    };

    return (
        <nav
            aria-label={t('nav.main')}
            className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ground/95 px-3 pt-2 backdrop-blur"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        >
            <div className="mx-auto flex max-w-[520px] items-center justify-between">
                {link('/', Home, t('navigation.home'), isHome)}
                {link('/activity', ListFilter, t('nav.activity'), pathname.startsWith('/activity') || pathname.startsWith('/activity'))}
                <button
                    type="button"
                    onClick={() => setAddReceiptModalOpen(true)}
                    aria-label={t('navigation.addReceipt')}
                    className="-mt-7 flex h-[60px] w-[60px] items-center justify-center rounded-full bg-forest text-white shadow-[0_6px_16px_rgba(0,87,63,.35)] transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-ink"
                >
                    <Plus size={28} strokeWidth={2.4} aria-hidden="true" />
                </button>
                {link('/plan', PieChart, t('nav.budgets'), pathname.startsWith('/plan'))}
                {link('/insights', Sparkles, t('nav.insights'), pathname.startsWith('/insights'))}
            </div>
        </nav>
    );
}
