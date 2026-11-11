import { useEffect, useRef } from 'react';
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';

const DAY_H = 44;
const ROW_H = 62;
const sizeOf = (items) => (i) => (items[i].kind === 'day' ? DAY_H : ROW_H);
const keyOf = (item) => (item.kind === 'day' ? `d-${item.key}` : item.tx.id);

// Rows that appear after the first paint (a new transaction) fade in; the rows below slide to their new place (transform transition)
// instead of jumping. The first paint and rows that only scroll into view do not animate.
function useNewIds(items) {
    const known = useRef(null);
    const fresh = new Set();
    if (known.current && known.current.size > 0) {
        const added = items.filter((i) => i.kind === 'tx' && !known.current.has(i.tx.id));
        if (added.length > 0 && added.length <= 3) added.forEach((i) => fresh.add(i.tx.id));
    }
    useEffect(() => {
        known.current = new Set(items.filter((i) => i.kind === 'tx').map((i) => i.tx.id));
    });
    return fresh;
}

function Rows({ virtualizer, items, renderItem, listRef, label }) {
    const fresh = useNewIds(items);
    return (
        <div ref={listRef} className="relative mx-5" style={{ height: virtualizer.getTotalSize() }} role="list" aria-label={label}>
            {virtualizer.getVirtualItems().map((v) => (
                <div key={keyOf(items[v.index])} role="listitem" className={`absolute inset-x-0 top-0 transition-transform duration-inline ease-out ${items[v.index].kind === 'tx' && fresh.has(items[v.index].tx.id) ? 'animate-row-in' : ''}`} style={{ height: v.size, transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}>
                    {renderItem(items[v.index])}
                </div>
            ))}
        </div>
    );
}

/** Phone: the page itself scrolls. */
function WindowList({ items, renderItem, label }) {
    const listRef = useRef(null);
    const virtualizer = useWindowVirtualizer({ count: items.length, estimateSize: sizeOf(items), overscan: 10, scrollMargin: listRef.current?.offsetTop || 0, initialRect: { width: 390, height: 844 } });
    return <Rows virtualizer={virtualizer} items={items} renderItem={renderItem} listRef={listRef} label={label} />;
}

/** Tablet: the list pane scrolls on its own, next to the detail pane. */
function ElementList({ items, renderItem, label, scrollEl }) {
    const listRef = useRef(null);
    const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => scrollEl, estimateSize: sizeOf(items), overscan: 10, scrollMargin: listRef.current?.offsetTop || 0, initialRect: { width: 400, height: 800 } });
    return <Rows virtualizer={virtualizer} items={items} renderItem={renderItem} listRef={listRef} label={label} />;
}

/** The day-grouped transaction list, virtualised. `scrollEl` is the scrolling pane (tablet) or null for the window (phone). */
export default function ActivityList({ items, renderItem, label, scrollEl = null }) {
    return scrollEl ? <ElementList items={items} renderItem={renderItem} label={label} scrollEl={scrollEl} /> : <WindowList items={items} renderItem={renderItem} label={label} />;
}
