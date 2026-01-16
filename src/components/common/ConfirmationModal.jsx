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
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="card max-w-md w-full">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-semibold dark:text-white">{title}</h4>
                    <button
                        onClick={onClose}
                        className="text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100"
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
                        className="flex-1"
                    >
                        {cancelText}
                    </Button>
                    <Button
                        variant={danger ? 'danger' : variant}
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                        className="flex-1"
                    >
                        {confirmText}
                    </Button>
                </div>
            </div>
        </div>
    );
}
