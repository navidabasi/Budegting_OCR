import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';
import { accessView, decideAccess, fetchAccessList, fetchAiAccess } from '../services/aiAccess';

const KEY = 'aiAccess';

/** The signed-in account's AI access: { status: unknown | pending | approved | denied, isAdmin, allowed, known, refresh }. */
export function useAiAccess() {
    const userId = useAppStore((s) => s.currentUser?.userId || null);
    const q = useQuery({ queryKey: [KEY, 'me', userId], queryFn: () => fetchAiAccess(userId), enabled: !!userId, staleTime: 5 * 60 * 1000, retry: 1 });
    return { ...accessView(q.data), loading: !!userId && q.isLoading, refresh: q.refetch };
}

/** Admin only: the accounts and the approve / deny action. */
export function useAiAccessAdmin(enabled) {
    const qc = useQueryClient();
    const list = useQuery({ queryKey: [KEY, 'list'], queryFn: () => fetchAccessList(), enabled: !!enabled, staleTime: 30 * 1000 });
    const decide = useMutation({
        mutationFn: ({ userId, status }) => decideAccess(userId, status),
        onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
    });
    return { accounts: list.data || [], loading: list.isLoading, error: list.error, decide: decide.mutateAsync, deciding: decide.isPending ? decide.variables?.userId : null };
}
