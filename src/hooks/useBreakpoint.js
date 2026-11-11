import { useEffect, useState } from 'react';

export const TABLET_MIN = 768;
export const DESKTOP_MIN = 1100;

const query = (px) => `(min-width: ${px}px)`;
const read = (px) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query(px)).matches : false);

/** 'phone' (< 768), 'tablet' (768-1099: list/detail panes) or 'desktop' (>= 1100: nav rail, table + detail pane). Same financial logic in all three. */
export function useBreakpoint() {
    const [bp, setBp] = useState(() => (read(DESKTOP_MIN) ? 'desktop' : read(TABLET_MIN) ? 'tablet' : 'phone'));
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const mqs = [window.matchMedia(query(TABLET_MIN)), window.matchMedia(query(DESKTOP_MIN))];
        const update = () => setBp(mqs[1].matches ? 'desktop' : mqs[0].matches ? 'tablet' : 'phone');
        update();
        mqs.forEach((m) => m.addEventListener?.('change', update));
        return () => mqs.forEach((m) => m.removeEventListener?.('change', update));
    }, []);
    return bp;
}
