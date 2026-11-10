import { useEffect, useRef } from 'react';
import { useTransactions } from '../data/hooks';

/**
 * Receipts (transactions) for the current user, read from the local mirror.
 * Refreshes automatically after local writes and syncs (React Query invalidation).
 * @returns {Object} { receipts, loading, reload }
 */
export function useReceipts() {
    const { transactions, loading, error, reload } = useTransactions();
    const errorLoggedRef = useRef(null);

    useEffect(() => {
        if (error && errorLoggedRef.current !== error) {
            errorLoggedRef.current = error;
            console.error('Failed to load receipts:', error);
        }
    }, [error]);

    return { receipts: transactions, loading, reload };
}
