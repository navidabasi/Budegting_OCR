// Keyboard navigation and sorting for the PC Activity table (pass 2 part 2, section 10). Pure.

/** The column that is sorted: 'date' | 'amount' (the sorts the filters already support) | null for the others. */
export const SORTABLE = { date: 'date', amount: 'amount' };

/** Next sort state when a header is activated: a new column starts descending (newest / largest first), the same column flips. */
export function toggleSort(current, column) {
    if (!SORTABLE[column]) return current;
    if (current.sort === column) return { sort: column, dir: current.dir === 'desc' ? 'asc' : 'desc' };
    return { sort: column, dir: 'desc' };
}

export const ariaSort = (current, column) => (current.sort === column ? (current.dir === 'asc' ? 'ascending' : 'descending') : 'none');

/**
 * Which row a key moves to. j / ArrowDown: next, k / ArrowUp: previous, Home / End: first / last. -1 (nothing selected) enters at
 * the first row going down, or the last row going up. Returns the same index when the key is not a movement key, or at the edges.
 */
export function moveSelection(key, index, length) {
    if (length <= 0) return -1;
    const down = key === 'j' || key === 'ArrowDown';
    const up = key === 'k' || key === 'ArrowUp';
    if (key === 'Home') return 0;
    if (key === 'End') return length - 1;
    if (!down && !up) return index;
    if (index < 0) return down ? 0 : length - 1;
    return Math.min(length - 1, Math.max(0, index + (down ? 1 : -1)));
}

/** Keys the table handles itself (the page must not also treat them as typing). */
export const isNavKey = (key) => ['j', 'k', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape'].includes(key);
