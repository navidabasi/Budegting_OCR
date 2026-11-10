import { useMemo } from 'react';
import { useLayoutData } from '../data/hooks';
import { getDefaultLayout } from '../components/dashboard/WidgetRegistry';

/**
 * User dashboard layout from the local mirror (falls back to the default layout).
 * @returns {Object} { layout, loading, reload }
 */
export function useUserLayout() {
    const { layoutRecord, loading, reload } = useLayoutData();

    const layout = useMemo(() => {
        const userLayout = layoutRecord?.layout;
        if (userLayout) {
            if (Array.isArray(userLayout.widgets) && Array.isArray(userLayout.enabled)) {
                return userLayout;
            }
            console.warn('[useUserLayout] Invalid layout structure, using default');
        }
        return getDefaultLayout();
    }, [layoutRecord]);

    return { layout, loading, reload };
}
