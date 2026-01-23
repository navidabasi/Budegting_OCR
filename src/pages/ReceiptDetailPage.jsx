import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { storageService } from '../services/storage';
import ReceiptDetail from '../components/receipts/ReceiptDetail';
import PageLayout from '../components/common/PageLayout';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';

export default function ReceiptDetailPage() {
    const { id } = useParams();
    const [receipt, setReceipt] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadReceipt();
    }, [id]);

    const loadReceipt = async () => {
        setLoading(true);
        try {
            const receiptId = parseInt(id);
            const receiptData = await storageService.getReceiptById(receiptId);
            setReceipt(receiptData);
        } catch (err) {
            console.error('Failed to load receipt:', err);
        } finally {
            setLoading(false);
        }
    };

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
        // ReceiptDetail already dispatches refresh events
        // Just reload the receipt list by navigating away
        loadReceipt();
    };

    return (
        <PageLayout>
            <ReceiptDetail
                receipt={receipt}
                onUpdate={loadReceipt}
                onDelete={handleDelete}
            />
        </PageLayout>
    );
}

