import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { electricStorage } from '../services/electricStorage';

/**
 * Custom hook for fetching and managing groups
 * Uses Electric + PGlite for local-first storage with real-time sync
 * @returns {Object} { groups, loading, reload }
 */
export function useGroups() {
    const currentUser = useAppStore((state) => state.currentUser);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadGroups = useCallback(async () => {
        if (!currentUser?.userId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const allGroups = await electricStorage.getGroups(currentUser.userId);
            setGroups(allGroups || []);
        } catch (err) {
            console.error('Failed to load groups:', err);
            setGroups([]);
        } finally {
            setLoading(false);
        }
    }, [currentUser]);

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
