import { X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import SettingsPage from '../../pages/SettingsPage';

export default function Sidebar() {
    const sidebarOpen = useAppStore((state) => state.sidebarOpen);
    const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);

    if (!sidebarOpen) return null;

    return (
        <>
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40"
                onClick={() => setSidebarOpen(false)}
            />
            <div className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-xl z-50 transform transition-transform duration-300 ease-in-out overflow-y-auto">
                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-start justify-between mb-1">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 mb-1">Settings</h1>
                            <p className="text-sm text-gray-500">Manage your account and preferences</p>
                        </div>
                        <button
                            onClick={() => setSidebarOpen(false)}
                            className="text-gray-500 hover:text-gray-700"
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

