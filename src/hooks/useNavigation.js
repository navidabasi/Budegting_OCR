import { useNavigate } from 'react-router-dom';
import { useCallback } from 'react';

/**
 * Custom hook for receipt-related navigation
 * @returns {Object} Navigation helper functions
 */
export function useReceiptNavigation() {
    const navigate = useNavigate();

    return {
        toReceipts: useCallback(() => navigate('/receipts'), [navigate]),
        toCategory: useCallback((category) => {
            navigate(`/receipts?filter=category&category=${encodeURIComponent(category)}`);
        }, [navigate]),
        toMerchant: useCallback((merchant) => {
            navigate(`/receipts?filter=merchant&merchant=${encodeURIComponent(merchant)}`);
        }, [navigate]),
        toMonth: useCallback((month, year) => {
            navigate(`/receipts?filter=month&month=${month}&year=${year}`);
        }, [navigate]),
        toReceiptDetail: useCallback((receiptId) => {
            navigate(`/receipts/${receiptId}`);
        }, [navigate])
    };
}
