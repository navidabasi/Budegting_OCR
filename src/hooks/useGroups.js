import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { electricStorage } from '../services/electricStorage';
import { tForLanguage } from '../languages';

/**
 * Custom hook for fetching and managing groups
 * Uses Electric + PGlite for local-first storage with real-time sync
 * @returns {Object} { groups, loading, reload }
 */
export function useGroups() {
    const currentUser = useAppStore((state) => state.currentUser);
    const languageCode = useAppStore((state) => state.languageCode);
    const showToast = useAppStore((state) => state.showToast);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const loadingRef = useRef(false);
    const offlineWarningShownRef = useRef(false);

    const loadGroups = useCallback(async () => {
        if (!currentUser?.userId) {
            setGroups([]);
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
                setTimeout(() => reject(new Error('Load groups timed out')), 15000)
            );

            const allGroups = await Promise.race([
                electricStorage.getGroups(currentUser.userId),
                timeoutPromise
            ]);
            setGroups(allGroups || []);
        } catch (err) {
            console.error('Failed to load groups:', err);
            if (err.message?.includes('Local cache unavailable while offline') && !offlineWarningShownRef.current) {
                showToast(tForLanguage(languageCode, 'errors.offlineGroupsUnavailable'), 'warning');
                offlineWarningShownRef.current = true;
            }

            if (!err.message?.includes('Local cache unavailable while offline')) {
                offlineWarningShownRef.current = false;
            }
            setGroups([]); // Set empty array on error so app doesn't hang
        } finally {
            setLoading(false);
            loadingRef.current = false;
        }
    }, [currentUser, showToast, languageCode]);

    useEffect(() => {
        loadGroups();
    }, [loadGroups]);

    // Listen for refresh events
    useEffect(() => {
        const handleRefresh = () => {
            loadGroups();
        };

        window.addEventListener('refreshGroups', handleRefresh);
        return () => {
            window.removeEventListener('refreshGroups', handleRefresh);
        };
    }, [loadGroups]);

    // Subscribe to Electric sync updates
    useEffect(() => {
        if (!currentUser) return;

        const unsubscribe = electricStorage.subscribe('groups', () => {
            loadGroups();
        });

        return unsubscribe;
    }, [currentUser, loadGroups]);

    return { groups, loading, reload: loadGroups };
}
