import { describe, it, expect, vi, afterEach } from 'vitest';
import { anchorDelta, captureAnchor, restoreAnchor } from '../scrollAnchor';

const el = (top, height = 50) => ({ getBoundingClientRect: () => ({ top, bottom: top + height }) });
// a list laid out from `start`, every row 50px tall
const layout = (n, start) => Array.from({ length: n }, (_, i) => el(start + i * 50));

afterEach(() => vi.restoreAllMocks());

describe('scroll anchoring', () => {
    it('anchors on the first item that is at least partly visible', () => {
        const items = layout(5, -120).map((e, i) => ({ key: `m${i}`, el: e })); // m0 -120..-70, m1 -70..-20, m2 -20..30 (cut by the top)
        expect(captureAnchor(items, 0)).toEqual({ key: 'm2', top: -20 });
    });
    it('returns null when nothing is visible', () => {
        expect(captureAnchor([{ key: 'a', el: el(-500) }], 0)).toBeNull();
        expect(captureAnchor([], 0)).toBeNull();
    });
    it('computes how far the anchored item moved when 30 rows were added above it', () => {
        const anchor = { key: 'm2', top: -20 };
        expect(anchorDelta(anchor, el(-20 + 30 * 50))).toBe(1500);
        expect(anchorDelta(anchor, el(-20))).toBe(0);
        expect(anchorDelta(anchor, null)).toBe(0);
    });
    it('scrolls the window by exactly that delta (no jump), or an inner scroller', () => {
        const spy = vi.fn();
        window.scrollBy = spy;
        expect(restoreAnchor({ key: 'k', top: 100 }, el(1600))).toBe(1500);
        expect(spy).toHaveBeenCalledWith(0, 1500);
        const scroller = { scrollTop: 200 };
        restoreAnchor({ key: 'k', top: 100 }, el(700), scroller);
        expect(scroller.scrollTop).toBe(800);
        spy.mockClear();
        restoreAnchor({ key: 'k', top: 100 }, el(100));
        expect(spy).not.toHaveBeenCalled();
    });
});
