import { useEffect } from 'react';
import { CheckCircle, XCircle, Info, AlertCircle, X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

export default function Toast() {
    const toast = useAppStore((state) => state.toast);
    const showToast = useAppStore((state) => state.showToast);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => {
                showToast(null);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [toast, showToast]);

    if (!toast) return null;

    const icons = {
        success: <CheckCircle className="text-primary-500" size={20} />,
        error: <XCircle className="text-red-500" size={20} />,
        warning: <AlertCircle className="text-yellow-500" size={20} />,
        info: <Info className="text-blue-500" size={20} />
    };

    const bgColors = {
        success: 'bg-primary-50 border-primary-200',
        error: 'bg-red-50 border-red-200',
        warning: 'bg-yellow-50 border-yellow-200',
        info: 'bg-blue-50 border-blue-200'
    };

    return (
        <div className="toast-container fixed top-4 right-4 z-50 animate-slide-in">
            <div className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border ${bgColors[toast.type] || bgColors.info} max-w-md`}>
                {icons[toast.type] || icons.info}
                <p className="flex-1 text-sm text-gray-800">{toast.message}</p>
                <button
                    onClick={() => showToast(null)}
                    className="text-gray-400 hover:text-gray-600"
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    );
}
