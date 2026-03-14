import { useLocation, useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import { buildReturnToPath } from '../utils/helpers';

/**
 * Custom hook for receipt-related navigation
 * @returns {Object} Navigation helper functions
 */
export function useReceiptNavigation() {
    const navigate = useNavigate();
    const location = useLocation();

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
            const returnTo = buildReturnToPath(location);
            const nextState = {
                ...(state || {}),
                returnTo: state?.returnTo || returnTo
            };
            navigate(`/receipts/${receiptId}`, { state: nextState });
        }, [navigate, location.pathname, location.search]),
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
