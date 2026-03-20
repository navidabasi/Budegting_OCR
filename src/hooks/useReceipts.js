import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { electricStorage } from '../services/electricStorage';
import { tForLanguage } from '../languages';

/**
 * Custom hook for fetching and managing receipts
 * Uses Electric + PGlite for local-first storage with real-time sync
 * @returns {Object} { receipts, loading, reload }
 */
export function useReceipts() {
    const currentUser = useAppStore((state) => state.currentUser);
    const languageCode = useAppStore((state) => state.languageCode);
    const showToast = useAppStore((state) => state.showToast);
    const [receipts, setReceipts] = useState([]);
    const [loading, setLoading] = useState(true);
    const loadingRef = useRef(false);
    const offlineWarningShownRef = useRef(false);

    const loadReceipts = useCallback(async () => {
        if (!currentUser) {
            setReceipts([]);
            setLoading(false);
            return;
        }

        // Prevent concurrent loads
        if (loadingRef.current) return;
        loadingRef.current = true;

        setLoading(true);
        try {
            // Add timeout to prevent hanging indefinitely
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Load receipts timed out')), 20000)
            );
            
            const userReceipts = await Promise.race([
                electricStorage.getReceipts(currentUser.userId),
                timeoutPromise
            ]);
            setReceipts(userReceipts || []);
        } catch (err) {
            console.error('Failed to load receipts:', err);

            if (err.message?.includes('Local cache unavailable while offline') && !offlineWarningShownRef.current) {
                showToast(tForLanguage(languageCode, 'errors.offlineReceiptsUnavailable'), 'warning');
                offlineWarningShownRef.current = true;
            }

            if (!err.message?.includes('Local cache unavailable while offline')) {
                offlineWarningShownRef.current = false;
            }

            setReceipts([]); // Set empty array on error so app doesn't hang
        } finally {
            setLoading(false);
            loadingRef.current = false;
        }
    }, [currentUser, showToast, languageCode]);

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
