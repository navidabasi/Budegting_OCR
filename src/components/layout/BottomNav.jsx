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
            // Already on home - scroll to top smoothly
            window.scrollTo({ top: 0, behavior: 'smooth' });
            // Also refresh the data
            window.dispatchEvent(new CustomEvent('refreshDashboard'));
        } else {
            navigate('/');
        }
    };

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-40 safe-area-bottom px-4 pb-4">
            <div
                className="relative flex items-center h-16 rounded-2xl shadow-lg border border-[#004030] max-w-xs mx-auto mb-4"
                style={{
                    backgroundColor: '#00573f',
                    maskImage: 'radial-gradient(circle 36px at 50% -8px, transparent 36px, black 37px)',
                    WebkitMaskImage: 'radial-gradient(circle 36px at 50% -8px, transparent 36px, black 37px)'
                }}
            >
                {/* Left side - Home (from left edge to left edge of notch) */}
                <button
                    onClick={handleHomeClick}
                    className={`flex flex-col items-center justify-center h-full ${isActive('/') ? 'text-white' : 'text-primary-200'
                        }`}
                    style={{
                        width: 'calc(50% - 36px)', // From left edge to left edge of notch (notch is 72px wide, centered at 50%)
                        minWidth: 'calc(50% - 36px)'
                    }}
                >
                    <Home size={24} />
                    <span className="text-xs mt-1">Home</span>
                </button>

                {/* Center spacer for notch (72px wide) */}
                <div className="bottom-nav-spacer" />

                {/* Right side - Receipts (from right edge of notch to right edge) */}
                <button
                    onClick={() => navigate('/receipts')}
                    className={`flex flex-col items-center justify-center h-full ${isActive('/receipts') ? 'text-white' : 'text-primary-200'
                        }`}
                    style={{
                        width: 'calc(50% - 36px)', // From right edge of notch to right edge
                        minWidth: 'calc(50% - 36px)'
                    }}
                >
                    <Receipt size={24} />
                    <span className="text-xs mt-1">Receipts</span>
                </button>
            </div>

            {/* Center - Plus Button (aligned with navbar top edge, centered using flexbox) */}
            <div className="floating-button-container">
                <button
                    onClick={() => setAddReceiptModalOpen(true)}
                    className="flex items-center justify-center w-14 h-14 rounded-full bg-white shadow-lg hover:bg-gray-50 active:bg-gray-100 transition-colors touch-manipulation"
                    aria-label="Add receipt"
                >
                    <Plus size={28} className="text-primary-600" />
                </button>
            </div>
        </nav>
    );
}

