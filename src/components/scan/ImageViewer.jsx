import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, X } from 'lucide-react';
import { IconButton } from '../ui';
import { useTranslation } from '../../languages/useTranslation';

/**
 * Full-screen receipt viewer. Pinch uses the browser's own gesture (touch-action: pinch-zoom on a natively
 * scrolling container); the +/- buttons give the same zoom without a gesture. Esc closes.
 */
export default function ImageViewer({ src, alt, onClose }) {
    const { t } = useTranslation();
    const [zoom, setZoom] = useState(1);
    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [onClose]);

    return createPortal(
        <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-[80] flex flex-col bg-black/95" data-testid="image-viewer">
            <div className="flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),12px)]">
                <IconButton label={t('ds.close')} icon={X} className="!text-white" onClick={onClose} data-autofocus />
                <div className="flex gap-1">
                    <IconButton label={t('scan.zoomOut')} icon={Minus} className="!text-white" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} />
                    <IconButton label={t('scan.zoomIn')} icon={Plus} className="!text-white" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} />
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
                <img src={src} alt={alt} draggable={false} className="mx-auto block max-w-none" style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? '100%' : 'none' }} onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))} />
            </div>
        </div>,
        document.body
    );
}
