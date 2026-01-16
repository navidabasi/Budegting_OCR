import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';
import SummaryCards from '../components/dashboard/SummaryCards';
import CategoryChart from '../components/dashboard/CategoryChart';
import ExpenseChart from '../components/dashboard/ExpenseChart';
import TopMerchants from '../components/dashboard/TopMerchants';
import { Loader, Settings } from 'lucide-react';

export default function HomePage() {
    const currentUser = useAppStore((state) => state.currentUser);
    const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
    const [receipts, setReceipts] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadReceipts = useCallback(async () => {
        if (!currentUser) return;

        setLoading(true);
        try {
            const userReceipts = await storageService.getReceiptsByUserId(currentUser.userId);
            setReceipts(userReceipts || []);
        } catch (err) {
            console.error('Failed to load receipts:', err);
        } finally {
            setLoading(false);
        }
    }, [currentUser]);

    useEffect(() => {
        loadReceipts();
    }, [loadReceipts]);

    // Listen for refresh event when already on home page
    useEffect(() => {
        const handleRefresh = () => {
            loadReceipts();
        };

        window.addEventListener('refreshDashboard', handleRefresh);
        return () => {
            window.removeEventListener('refreshDashboard', handleRefresh);
        };
    }, [loadReceipts]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader className="animate-spin text-primary-600" size={32} />
            </div>
        );
    }

    return (
        <div className="pb-24 px-4 pt-6">
            <div className="mb-8">
                <div className="flex items-start justify-between mb-1">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 mb-1">Dashboard</h1>
                        <p className="text-sm text-gray-500">Overview of your expenses</p>
                    </div>
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                        aria-label="Settings"
                    >
                        <Settings size={24} className="text-gray-600" />
                    </button>
                </div>
            </div>

            <SummaryCards receipts={receipts} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <CategoryChart receipts={receipts} />
                <ExpenseChart receipts={receipts} />
            </div>

            <TopMerchants receipts={receipts} />
        </div>
    );
}

