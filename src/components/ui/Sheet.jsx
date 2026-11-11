import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet: drag handle (drag down to close), focus trap, Esc + backdrop close, safe-area padding,
 * body scroll lock. Reduced motion is handled globally in index.css.
 */
export default function Sheet({ open, onClose, label, children, className = '', fullHeight = false }) {
    const panelRef = useRef(null);
    const dragRef = useRef(null);
    const returnFocusRef = useRef(null);
    // The effect below must run when the sheet opens or closes only: a parent that passes a new onClose on every render (typing in a
    // field re-renders it) would otherwise move the focus back to the first control each time.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!open) return undefined;
        returnFocusRef.current = document.activeElement;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const panel = panelRef.current;
        const first = panel?.querySelector('[data-autofocus]') || panel?.querySelector(FOCUSABLE);
        (first || panel)?.focus?.();

        const onKey = (e) => {
            // Keys inside a nested dialog (portal / sibling) belong to that dialog
            if (panel && e.target?.nodeType === 1 && e.target !== document.body && !panel.contains(e.target)) return;
            if (e.key === 'Escape') {
                e.stopPropagation();
                onCloseRef.current?.();
                return;
            }
            if (e.key !== 'Tab' || !panel) return;
            const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
            if (items.length === 0) {
                e.preventDefault();
                return;
            }
            const a = items[0];
            const z = items[items.length - 1];
            if (e.shiftKey && document.activeElement === a) {
                e.preventDefault();
                z.focus();
            } else if (!e.shiftKey && document.activeElement === z) {
                e.preventDefault();
                a.focus();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            document.body.style.overflow = prevOverflow;
            returnFocusRef.current?.focus?.();
        };
    }, [open]);

    if (!open) return null;

    const onHandleDown = (e) => {
        dragRef.current = { startY: e.clientY, dy: 0 };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onHandleMove = (e) => {
        if (!dragRef.current) return;
        const dy = Math.max(0, e.clientY - dragRef.current.startY);
        dragRef.current.dy = dy;
        if (panelRef.current) panelRef.current.style.transform = `translateY(${dy}px)`;
    };
    const onHandleUp = () => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag) return;
        if (drag.dy > 110) onClose?.();
        else if (panelRef.current) panelRef.current.style.transform = '';
    };

    return createPortal(
        <div className="fixed inset-0 z-[60] flex flex-col justify-end" data-testid="sheet-root">
            <div className="absolute inset-0 animate-fade-in bg-[#10211B]/45" onClick={onClose} aria-hidden="true" data-testid="sheet-backdrop" />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={label}
                tabIndex={-1}
                className={`relative mx-auto flex w-full max-w-[520px] animate-sheet-up flex-col rounded-t-sheet bg-ground shadow-[0_-8px_30px_rgba(16,33,27,.18)] outline-none ${fullHeight ? 'h-[94dvh]' : 'max-h-[96dvh]'} ${className}`}
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
            >
                <div
                    className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
                    onPointerDown={onHandleDown}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    onPointerCancel={onHandleUp}
                    data-testid="sheet-handle"
                >
                    <div className="h-1 w-10 rounded-full bg-line-strong" />
                </div>
                {children}
            </div>
        </div>,
        document.body
    );
}
