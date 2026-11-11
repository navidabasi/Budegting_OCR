// Motion tokens and the reduced-motion rule (pass 2 part 2, section 11). Pure apart from applyMotionMode (sets one attribute).
//
// The same tokens live in CSS (src/index.css :root, --mo-*) and Tailwind (duration-press / duration-inline / duration-sheet,
// ease-out); these constants are for the few animations that run from JS (chart.js, the sheet exit).
export const DURATION = Object.freeze({ press: 120, inline: 190, sheet: 260 });
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const MOTION_MODES = ['system', 'reduced', 'full'];

/** Does the system ask for reduced motion? Without matchMedia (old webviews, tests) the safe answer is yes. */
export function systemPrefersReduced() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The app setting wins over the system: 'reduced' | 'full' force it, 'system' (default) follows the device. */
export const resolveReduced = (mode, system = systemPrefersReduced()) => (mode === 'reduced' ? true : mode === 'full' ? false : !!system);

/** Put the decision on <html data-motion="reduced|full"> so CSS can react (index.css). */
export function applyMotionMode(mode, root = typeof document === 'undefined' ? null : document.documentElement) {
    if (!root) return;
    root.dataset.motion = resolveReduced(mode) ? 'reduced' : 'full';
}

/** chart.js `animation` option: nothing on first paint or when only the data refreshed; a short ease-out when the selection changed. */
export const chartAnimation = ({ reduced, selectionChanged }) => (reduced || !selectionChanged ? false : { duration: DURATION.sheet, easing: 'easeOutCubic' });
