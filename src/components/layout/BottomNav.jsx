import { Home, Receipt, Plus } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';

export default function BottomNav() {
    const navigate = useNavigate();
    const location = useLocation();
    const setAddReceiptModalOpen = useAppStore((state) => state.setAddReceiptModalOpen);

    const isActive = (path) => location.pathname === path;

    const handleHomeClick = () => {
        if (location.pathname === '/') {
            // Already on home, just refresh the data by dispatching a custom event
            window.dispatchEvent(new CustomEvent('refreshDashboard'));
        } else {
            navigate('/');
        }
    };

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-40 safe-area-bottom px-4 pb-4">
            <div
                className="relative flex items-center justify-between h-16 px-1 rounded-2xl shadow-lg border border-[#004030] max-w-xs mx-auto mb-4"
                style={{
                    backgroundColor: '#00573f',
                    maskImage: 'radial-gradient(circle 36px at 50% -8px, transparent 36px, black 37px)',
                    WebkitMaskImage: 'radial-gradient(circle 36px at 50% -8px, transparent 36px, black 37px)'
                }}
            >
                {/* Left side - Home */}
                <button
                    onClick={handleHomeClick}
                    className={`flex flex-col items-center justify-center flex-1 h-full ${isActive('/') ? 'text-white' : 'text-primary-200'
                        }`}
                >
                    <Home size={24} />
                    <span className="text-xs mt-1">Home</span>
                </button>

                {/* Right side - Receipts */}
                <button
                    onClick={() => navigate('/receipts')}
                    className={`flex flex-col items-center justify-center flex-1 h-full ${isActive('/receipts') ? 'text-white' : 'text-primary-200'
                        }`}
                >
                    <Receipt size={24} />
                    <span className="text-xs mt-1">Receipts</span>
                </button>
            </div>

            {/* Center - Plus Button (aligned with navbar top edge) */}
            <div className="absolute left-1/2 transform -translate-x-1/2 z-50" style={{ bottom: 'calc(1rem + 1rem + 3.5rem - 1.75rem)' }}>
                <button
                    onClick={() => setAddReceiptModalOpen(true)}
                    className="flex items-center justify-center w-14 h-14 rounded-full bg-white shadow-lg hover:bg-gray-50 transition-colors"
                >
                    <Plus size={28} className="text-primary-600" />
                </button>
            </div>
        </nav>
    );
}

