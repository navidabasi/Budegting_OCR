import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';

/**
 * Custom hook for fetching and managing groups
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
            const allGroups = await storageService.getAllGroups(currentUser.userId);
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

    return { groups, loading, reload: loadGroups };
}
