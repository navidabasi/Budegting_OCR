import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';

/**
 * Custom hook for fetching and managing receipts
 * @returns {Object} { receipts, loading, reload }
 */
export function useReceipts() {
    const currentUser = useAppStore((state) => state.currentUser);
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

    // Listen for refresh events
    useEffect(() => {
        const handleRefresh = () => {
            loadReceipts();
        };

        window.addEventListener('refreshReceipts', handleRefresh);
        return () => {
            window.removeEventListener('refreshReceipts', handleRefresh);
        };
    }, [loadReceipts]);

    return { receipts, loading, reload: loadReceipts };
}
