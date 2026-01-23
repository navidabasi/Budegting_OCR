import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import Button from './Button';

export default function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title = 'Confirm',
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'primary',
    danger = false
}) {
    // Prevent body scroll when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            // Prevent touch scrolling on mobile
            document.body.style.position = 'fixed';
            document.body.style.width = '100%';
        } else {
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.width = '';
        }
        return () => {
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.width = '';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const handleBackdropClick = (e) => {
        // Only close if clicking the backdrop itself, not children
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    const handleConfirm = () => {
        onConfirm();
        onClose();
    };

    const modalContent = (
        <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
            onClick={handleBackdropClick}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            style={{
                touchAction: 'none',
                WebkitOverflowScrolling: 'touch',
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0
            }}
        >
            <div 
                className="card max-w-md w-full relative z-[10000]"
                onClick={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                style={{
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    touchAction: 'pan-y'
                }}
            >
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-semibold dark:text-white">{title}</h4>
                    <button
                        onClick={onClose}
                        className="text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 touch-manipulation"
                        className="touch-target"
                    >
                        <X size={20} />
                    </button>
                </div>
                <p className="text-gray-700 dark:text-gray-300 mb-6">
                    {message}
                </p>
                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        onClick={onClose}
                        className="flex-1 touch-manipulation touch-target"
                    >
                        {cancelText}
                    </Button>
                    <Button
                        variant={danger ? 'danger' : variant}
                        onClick={handleConfirm}
                        className="flex-1 touch-manipulation touch-target"
                    >
                        {confirmText}
                    </Button>
                </div>
            </div>
        </div>
    );

    // Render modal at root level using portal to avoid z-index issues
    return createPortal(modalContent, document.body);
}
