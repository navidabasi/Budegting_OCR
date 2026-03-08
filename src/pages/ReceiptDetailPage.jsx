import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';
import ReceiptDetail from '../components/receipts/ReceiptDetail';
import PageLayout from '../components/common/PageLayout';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';

export default function ReceiptDetailPage() {
    const { id } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const showToast = useAppStore((state) => state.showToast);
    const initialReceipt = location.state?.initialReceipt?.id === id ? location.state.initialReceipt : null;
    const [receipt, setReceipt] = useState(initialReceipt);
    const [loading, setLoading] = useState(!initialReceipt);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let active = true;

        // Optimistic render from navigation state when available
        setReceipt(initialReceipt || null);

        const loadReceipt = async () => {
            const shouldShowSpinner = !initialReceipt;
            if (shouldShowSpinner) {
                setLoading(true);
            }

            try {
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Load receipt timed out')), 10000)
                );

                // Use ID as-is (UUID string)
                const receiptData = await Promise.race([
                    storageService.getReceiptById(id),
                    timeoutPromise
                ]);

                if (!active) return;

                if (!receiptData) {
                    throw new Error('Receipt not found');
                }

                setReceipt(receiptData);
            } catch (err) {
                if (!active) return;
                console.error('Failed to load receipt:', err);

                const fallbackDate = initialReceipt?.date ? new Date(initialReceipt.date) : new Date();
                const month = fallbackDate.getMonth() + 1;
                const year = fallbackDate.getFullYear();

                showToast('Unable to open receipt details. Showing month receipts instead.', 'warning');
                navigate(`/receipts?filter=month&month=${month}&year=${year}`, { replace: true });
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        loadReceipt();

        return () => {
            active = false;
        };
    }, [id, initialReceipt, navigate, reloadKey, showToast]);

    if (loading) {
        return <LoadingSpinner className="pb-20" />;
    }

    if (!receipt) {
        return (
            <PageLayout>
                <EmptyState message="Receipt not found" />
            </PageLayout>
        );
    }

    const handleDelete = () => {
        // ReceiptDetail handles the redirect to /receipts after delete.
    };

    return (
        <PageLayout>
            <ReceiptDetail
                receipt={receipt}
                onUpdate={() => setReloadKey((prev) => prev + 1)}
                onDelete={handleDelete}
            />
        </PageLayout>
    );
}
