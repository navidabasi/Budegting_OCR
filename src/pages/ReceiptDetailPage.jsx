import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { storageService } from '../services/storage';
import ReceiptDetail from '../components/receipts/ReceiptDetail';
import { Loader } from 'lucide-react';

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
        return (
            <div className="flex items-center justify-center min-h-screen pb-20">
                <Loader className="animate-spin text-primary-600" size={32} />
            </div>
        );
    }

    if (!receipt) {
        return (
            <div className="pb-20 px-4 pt-6">
                <div className="card text-center py-12">
                    <p className="text-gray-500">Receipt not found</p>
                </div>
            </div>
        );
    }

    return (
        <div className="pb-20 px-4 pt-6">
            <ReceiptDetail
                receipt={receipt}
                onUpdate={loadReceipt}
                onDelete={() => { }}
            />
        </div>
    );
}

