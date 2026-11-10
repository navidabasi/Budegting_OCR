import { useGroupsData } from '../data/hooks';

/**
 * Groups for the current user, read from the local mirror.
 * @returns {Object} { groups, loading, reload }
 */
export function useGroups() {
    const { groups, loading, reload } = useGroupsData();
    return { groups, loading, reload };
}
