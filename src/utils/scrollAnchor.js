// Keeps the reading position when older messages are added above the visible ones: remember the first visible item and how
// far below the top of the viewport it sat, then after the update scroll by exactly how far that item moved.

/**
 * First item (in document order) whose bottom edge is below `viewportTop`, i.e. the first one at least partly visible.
 * `items`: [{ key, el }]. -> { key, top } | null
 */
export function captureAnchor(items, viewportTop = 0) {
    for (const { key, el } of items) {
        const r = el?.getBoundingClientRect?.();
        if (r && r.bottom > viewportTop) return { key, top: r.top };
    }
    return null;
}

/** Pixels to scroll so the anchored item is back at the same place: positive scrolls down. 0 when the item is gone. */
export function anchorDelta(anchor, el) {
    if (!anchor || !el?.getBoundingClientRect) return 0;
    return Math.round(el.getBoundingClientRect().top - anchor.top);
}

/** Apply the correction to the window (scroller omitted) or to a scrollable element. */
export function restoreAnchor(anchor, el, scroller = null) {
    const dy = anchorDelta(anchor, el);
    if (!dy) return 0;
    if (scroller) scroller.scrollTop += dy;
    else window.scrollBy(0, dy);
    return dy;
}
