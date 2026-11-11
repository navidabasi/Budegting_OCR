import { useMemo } from 'react';
import { eligibleForAutoTrip, resolveGroup, tripForDate } from '../utils/tripMath';

/**
 * The group a new transaction is saved to: an explicit pick, else the active trip (or the trip containing the date),
 * unless the user removed the trip chip. Shared by Quick Add and the scan review.
 *   { group, tripOfGroup, mergeMore(newMore) -> { more, tripDetached }, detach() -> { more, tripDetached } }
 */
export function useTripGroup({ trips, date, more, detached = false, auto = true }) {
    const eligible = eligibleForAutoTrip(more);
    const autoTrip = useMemo(() => (auto && eligible ? tripForDate(trips, date) : null), [auto, eligible, trips, date]);
    const group = resolveGroup(more, autoTrip, detached);
    const tripOfGroup = group.groupId ? (trips || []).find((x) => x.id === group.groupId) || null : null;
    return {
        group,
        tripOfGroup,
        /** Apply a change coming from MoreSection (which was given the resolved group as its value). */
        mergeMore: (next) => {
            const changed = next.groupId !== group.groupId;
            return changed
                ? { more: next, tripDetached: next.groupId == null ? true : detached }
                : { more: { ...next, groupId: more.groupId, groupName: more.groupName }, tripDetached: detached };
        },
        detach: () => ({ more: { ...more, groupId: null, groupName: null }, tripDetached: true }),
    };
}
