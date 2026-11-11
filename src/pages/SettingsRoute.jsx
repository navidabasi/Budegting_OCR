import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import SettingsPage from './SettingsPage';
import { IconButton } from '../components/ui';
import { useTranslation } from '../languages/useTranslation';

/**
 * Settings as a real destination (/settings) with its own header and back button, instead of a drawer. Back goes to where the owner
 * came from (filters and scroll of that screen are kept by the screens themselves), or Home when opened directly.
 */
export default function SettingsRoute() {
    const { t, isRtl } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const Back = isRtl ? ChevronRight : ChevronLeft;
    const back = () => (location.key !== 'default' ? navigate(-1) : navigate('/', { replace: true }));
    return (
        <main className="mx-auto w-full max-w-[720px] pb-32" data-testid="settings-route">
            <div className="sticky top-0 z-20 flex items-center gap-1 bg-ground/95 px-3 pb-2 pt-[max(env(safe-area-inset-top),12px)] backdrop-blur">
                <IconButton label={t('common.actions.back')} icon={Back} size={22} onClick={back} />
                <div className="flex min-w-0 flex-col">
                    <h1 className="truncate font-display text-[22px] font-bold leading-tight text-ink">{t('settings.sidebarTitle')}</h1>
                    <p className="truncate text-[13px] text-ink-muted">{t('settings.sidebarSubtitle')}</p>
                </div>
            </div>
            <div className="px-4 pt-2">
                <SettingsPage />
            </div>
        </main>
    );
}
