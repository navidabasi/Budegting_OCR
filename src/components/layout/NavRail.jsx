import { Home, ListFilter, PieChart, Plus, Settings, Sparkles } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';

const itemClass = (active) =>
    `flex min-h-[56px] w-[72px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink ${
        active ? 'bg-mint text-forest-ink' : 'text-ink-muted hover:bg-tint'
    }`;

/** PC layout (>= 1100 px): the same destinations as the bottom bar, as a left rail. The + button stays reachable at the top. */
export default function NavRail() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const setAddReceiptModalOpen = useAppStore((s) => s.setAddReceiptModalOpen);
    if (pathname.startsWith('/welcome') || pathname.startsWith('/scan')) return null;
    const isHome = pathname === '/' || pathname === '/dashboard';
    const link = (to, Icon, label, active) => (
        <NavLink to={to} aria-label={label} aria-current={active ? 'page' : undefined} className={itemClass(active)}>
            <Icon size={22} aria-hidden="true" />
            <span className="max-w-full truncate">{label}</span>
        </NavLink>
    );
    return (
        <nav aria-label={t('nav.main')} data-testid="nav-rail" className="fixed inset-y-0 start-0 z-40 hidden w-24 flex-col items-center gap-2 border-e border-line bg-surface py-5 desk:flex">
            <button
                type="button"
                onClick={() => setAddReceiptModalOpen(true)}
                aria-label={t('navigation.addReceipt')}
                className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-forest text-white shadow-[0_6px_16px_rgba(0,87,63,.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-ink"
            >
                <Plus size={26} strokeWidth={2.4} aria-hidden="true" />
            </button>
            {link('/', Home, t('navigation.home'), isHome)}
            {link('/activity', ListFilter, t('nav.activity'), pathname.startsWith('/activity'))}
            {link('/plan', PieChart, t('nav.budgets'), pathname.startsWith('/plan'))}
            {link('/insights', Sparkles, t('nav.insights'), pathname.startsWith('/insights'))}
            <span className="flex-1" aria-hidden="true" />
            {link('/settings', Settings, t('navigation.settings'), pathname.startsWith('/settings'))}
        </nav>
    );
}
