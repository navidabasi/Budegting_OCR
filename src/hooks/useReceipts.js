import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { electricStorage } from '../services/electricStorage';

/**
 * Custom hook for fetching and managing receipts
 * Uses Electric + PGlite for local-first storage with real-time sync
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
            const userReceipts = await electricStorage.getReceipts(currentUser.userId);
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

    // Listen for refresh events (triggered by Electric sync or local changes)
    useEffect(() => {
        const handleRefresh = () => {
            loadReceipts();
        };

        window.addEventListener('refreshReceipts', handleRefresh);
        return () => {
            window.removeEventListener('refreshReceipts', handleRefresh);
        };
    }, [loadReceipts]);

    // Subscribe to Electric sync updates
    useEffect(() => {
        if (!currentUser) return;

        const unsubscribe = electricStorage.subscribe('receipts', () => {
            loadReceipts();
        });

        return unsubscribe;
    }, [currentUser, loadReceipts]);

    return { receipts, loading, reload: loadReceipts };
}
