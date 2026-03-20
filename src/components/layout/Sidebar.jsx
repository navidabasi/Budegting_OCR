import { X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import SettingsPage from '../../pages/SettingsPage';
import { useTranslation } from '../../languages/useTranslation';

export default function Sidebar() {
    const { t } = useTranslation();
    const sidebarOpen = useAppStore((state) => state.sidebarOpen);
    const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);

    if (!sidebarOpen) return null;

    return (
        <>
            <div
                className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 z-40"
                onClick={() => setSidebarOpen(false)}
            />
            <div className="sidebar-panel fixed right-0 top-0 bottom-0 w-80 bg-white dark:bg-gray-800 shadow-xl z-50 transform transition-transform duration-300 ease-in-out overflow-y-auto">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-start justify-between mb-1">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-1">{t('settings.sidebarTitle')}</h1>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings.sidebarSubtitle')}</p>
                        </div>
                        <button
                            onClick={() => setSidebarOpen(false)}
                            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>
                <div className="p-4">
                    <SettingsPage />
                </div>
            </div>
        </>
    );
}
