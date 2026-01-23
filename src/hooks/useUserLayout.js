import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';
import { getDefaultLayout } from '../components/dashboard/WidgetRegistry';

/**
 * Custom hook for fetching and managing user dashboard layout
 * @returns {Object} { layout, loading, reload }
 */
export function useUserLayout() {
    const currentUser = useAppStore((state) => state.currentUser);
    const [layout, setLayout] = useState(null);
    const [loading, setLoading] = useState(true);

    const loadLayout = useCallback(async () => {
        if (!currentUser) {
            setLayout(getDefaultLayout());
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const userLayout = await storageService.getUserLayout(currentUser.userId);
            if (userLayout) {
                // Validate layout structure
                if (userLayout.widgets && Array.isArray(userLayout.widgets) && userLayout.enabled && Array.isArray(userLayout.enabled)) {
                    setLayout(userLayout);
                } else {
                    console.warn('[useUserLayout] Invalid layout structure, using default');
                    setLayout(getDefaultLayout());
                }
            } else {
                setLayout(getDefaultLayout());
            }
        } catch (err) {
            console.error('Failed to load layout:', err);
            setLayout(getDefaultLayout());
        } finally {
            setLoading(false);
        }
    }, [currentUser]);

    useEffect(() => {
        loadLayout();
    }, [loadLayout]);

    // Listen for refresh events
    useEffect(() => {
        const handleRefresh = () => {
            loadLayout();
        };

        window.addEventListener('refreshLayout', handleRefresh);
        return () => {
            window.removeEventListener('refreshLayout', handleRefresh);
        };
    }, [loadLayout]);

    return { layout, loading, reload: loadLayout };
}
