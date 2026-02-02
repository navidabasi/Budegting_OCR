import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { electricStorage } from '../services/electricStorage';
import { getDefaultLayout } from '../components/dashboard/WidgetRegistry';

/**
 * Custom hook for fetching and managing user dashboard layout
 * Uses Electric + PGlite for local-first storage with real-time sync
 * @returns {Object} { layout, loading, reload }
 */
export function useUserLayout() {
    const currentUser = useAppStore((state) => state.currentUser);
    const [layout, setLayout] = useState(null);
    const [loading, setLoading] = useState(true);
    const loadingRef = useRef(false);

    const loadLayout = useCallback(async () => {
        if (!currentUser) {
            setLayout(getDefaultLayout());
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
                setTimeout(() => reject(new Error('Load layout timed out')), 15000)
            );

            const userLayoutData = await Promise.race([
                electricStorage.getUserLayout(currentUser.userId),
                timeoutPromise
            ]);

            if (userLayoutData?.layout) {
                const userLayout = userLayoutData.layout;
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
            setLayout(getDefaultLayout()); // Use default on error so app doesn't hang
        } finally {
            setLoading(false);
            loadingRef.current = false;
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

    // Subscribe to Electric sync updates
    useEffect(() => {
        if (!currentUser) return;

        const unsubscribe = electricStorage.subscribe('user_layouts', () => {
            loadLayout();
        });

        return unsubscribe;
    }, [currentUser, loadLayout]);

    return { layout, loading, reload: loadLayout };
}
