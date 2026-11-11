import { useRef } from 'react';
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';

const DAY_H = 44;
const ROW_H = 62;
const sizeOf = (items) => (i) => (items[i].kind === 'day' ? DAY_H : ROW_H);
const keyOf = (item) => (item.kind === 'day' ? `d-${item.key}` : item.tx.id);

function Rows({ virtualizer, items, renderItem, listRef, label }) {
    return (
        <div ref={listRef} className="relative mx-5" style={{ height: virtualizer.getTotalSize() }} role="list" aria-label={label}>
            {virtualizer.getVirtualItems().map((v) => (
                <div key={keyOf(items[v.index])} role="listitem" className="absolute inset-x-0 top-0" style={{ height: v.size, transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}>
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
