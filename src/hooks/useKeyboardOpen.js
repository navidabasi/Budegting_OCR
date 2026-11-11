import { useEffect, useState } from 'react';

const NON_TEXT = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color', 'date', 'image', 'hidden']);
const isTextField = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !NON_TEXT.has(el.type)) || el.isContentEditable);

/**
 * Is the on-screen keyboard open? { open, inset }
 *   open   a text field has focus and the visible viewport is much shorter than the tallest one seen (the keyboard took the space)
 *   inset  how many px of the layout viewport the keyboard covers (iOS keeps fixed bars where they were, behind the keyboard)
 * Screens use it to drop bars they do not need while typing (bottom nav, big keypad, secondary buttons) and to lift fixed bars.
 */
export function useKeyboardOpen() {
    const [state, setState] = useState({ open: false, inset: 0 });
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const vv = window.visualViewport;
        let maxH = Math.max(window.innerHeight, vv?.height || 0);
        const update = () => {
            const h = vv ? vv.height : window.innerHeight;
            maxH = Math.max(maxH, window.innerHeight, h);
            const inset = vv ? Math.max(0, Math.round(window.innerHeight - h - vv.offsetTop)) : 0;
            const open = isTextField(document.activeElement) && maxH - h > 120;
            setState((s) => (s.open === open && s.inset === inset ? s : { open, inset }));
        };
        const later = () => setTimeout(update, 0);
        const reset = () => {
            maxH = 0;
            update();
        };
        update();
        document.addEventListener('focusin', update);
        document.addEventListener('focusout', later);
        window.addEventListener('resize', update);
        window.addEventListener('orientationchange', reset);
        vv?.addEventListener('resize', update);
        vv?.addEventListener('scroll', update);
        return () => {
            document.removeEventListener('focusin', update);
            document.removeEventListener('focusout', later);
            window.removeEventListener('resize', update);
            window.removeEventListener('orientationchange', reset);
            vv?.removeEventListener('resize', update);
            vv?.removeEventListener('scroll', update);
        };
    }, []);
    return state;
}
