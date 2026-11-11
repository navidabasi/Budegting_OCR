import { Plane } from 'lucide-react';

/** Colour dot + group name, used on transaction rows, the table and pickers. Trips show a plane instead of the dot. */
export default function GroupBadge({ group, className = '' }) {
    if (!group?.name) return null;
    const trip = group.kind === 'trip';
    return (
        <span className={`inline-flex min-w-0 max-w-[10rem] shrink items-center gap-1 ${className}`} data-testid="group-badge">
            {trip ? (
                <Plane size={11} className="shrink-0" style={{ color: group.color || undefined }} aria-hidden="true" />
            ) : (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group.color || '#6b7280' }} aria-hidden="true" />
            )}
            <span className="truncate">{group.name}</span>
        </span>
    );
}
