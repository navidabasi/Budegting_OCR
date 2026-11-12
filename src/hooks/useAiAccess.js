import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';
import { accessView, decideAccess, fetchAccessList, fetchAiAccess } from '../services/aiAccess';

const KEY = 'aiAccess';

/** The signed-in account's AI access: { status: unknown | pending | approved | denied, isAdmin, allowed, known, loading, refresh }. */
export function useAiAccess() {
    const userId = useAppStore((s) => s.currentUser?.userId || null);
    const q = useQuery({ queryKey: [KEY, 'me', userId], queryFn: () => fetchAiAccess(userId), enabled: !!userId, staleTime: 5 * 60 * 1000, retry: 1 });
    return { ...accessView(q.data), loading: !!userId && q.isLoading, refresh: q.refetch };
}

/**
 * Admin only: the accounts and the decision. `decide({ userIds, status })` applies one status to one or many accounts (a few at a
 * time) and reports { done, failed } so a partial failure can be shown.
 */
export function useAiAccessAdmin(enabled) {
    const qc = useQueryClient();
    const list = useQuery({ queryKey: [KEY, 'list'], queryFn: () => fetchAccessList(), enabled: !!enabled, staleTime: 30 * 1000 });
    const decide = useMutation({
        mutationFn: async ({ userIds, status }) => {
            const ids = [...new Set(userIds)];
            let done = 0;
            let failed = 0;
            for (let i = 0; i < ids.length; i += 5) {
                const results = await Promise.allSettled(ids.slice(i, i + 5).map((id) => decideAccess(id, status)));
                done += results.filter((r) => r.status === 'fulfilled').length;
                failed += results.filter((r) => r.status === 'rejected').length;
            }
            return { done, failed };
        },
        onSettled: () => qc.invalidateQueries({ queryKey: [KEY] }),
    });
    return { accounts: list.data || [], loading: list.isLoading, error: list.error, decide: decide.mutateAsync, busy: decide.isPending, busyIds: decide.isPending ? decide.variables?.userIds || [] : [] };
}
