import { useEffect, useRef } from 'react';

const PREFIX = 'wmw.scroll:';
const read = (key) => {
    try {
        const v = Number(sessionStorage.getItem(PREFIX + key));
        return Number.isFinite(v) && v > 0 ? v : 0;
    } catch {
        return 0;
    }
};
const write = (key, y) => {
    try {
        if (y > 0) sessionStorage.setItem(PREFIX + key, String(Math.round(y)));
        else sessionStorage.removeItem(PREFIX + key);
    } catch {
        /* storage unavailable: the list just starts at the top */
    }
};

/**
 * Remember where a list was scrolled when the screen is left (to a detail page) and put it back when the owner returns, so back
 * navigation does not lose the place. `key` should include the filters (the URL search), `ready` is true once the list is rendered.
 * `getEl` returns the scrolling element, or null for the window.
 */
export function useScrollMemory(key, { ready, getEl = () => null } = {}) {
    const restored = useRef(null);
    const getElRef = useRef(getEl);
    getElRef.current = getEl;
    useEffect(() => {
        if (!ready || restored.current === key) return;
        restored.current = key;
        const y = read(key);
        if (!y) return;
        const frame = requestAnimationFrame(() => {
            const el = getElRef.current();
            if (el) el.scrollTop = y;
            else window.scrollTo(0, y);
        });
        return () => cancelAnimationFrame(frame);
    }, [ready, key]);
    useEffect(
        () => () => {
            const el = getElRef.current();
            write(key, el ? el.scrollTop : window.scrollY);
        },
        [key]
    );
}
