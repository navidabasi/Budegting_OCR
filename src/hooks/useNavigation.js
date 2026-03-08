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
        toReceiptDetail: useCallback((receiptId, state = undefined) => {
            navigate(`/receipts/${receiptId}`, state ? { state } : undefined);
        }, [navigate]),
        // Navigate to all income receipts (all time)
        toAllIncome: useCallback(() => {
            navigate('/receipts?type=income');
        }, [navigate]),
        // Navigate to all expense receipts (all time)
        toAllExpenses: useCallback(() => {
            navigate('/receipts?type=expense');
        }, [navigate]),
        // Navigate to income for a specific month
        toMonthlyIncome: useCallback((month, year) => {
            navigate(`/receipts?type=income&month=${month}&year=${year}`);
        }, [navigate]),
        // Navigate to expenses for a specific month
        toMonthlyExpenses: useCallback((month, year) => {
            navigate(`/receipts?type=expense&month=${month}&year=${year}`);
        }, [navigate])
    };
}
