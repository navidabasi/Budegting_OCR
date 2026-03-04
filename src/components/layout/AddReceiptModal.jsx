import { useState, useRef, useEffect } from 'react';
import { Camera, Upload, FileText, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { storageService } from '../../services/storage';
import Modal from '../common/Modal';
import ReceiptForm from '../receipts/ReceiptForm';
import ReceiptUpload from '../receipts/ReceiptUpload';
import ErrorBoundary from '../common/ErrorBoundary';

export default function AddReceiptModal() {
    const addReceiptModalOpen = useAppStore((state) => state.addReceiptModalOpen);
    const setAddReceiptModalOpen = useAppStore((state) => state.setAddReceiptModalOpen);
    const currentUser = useAppStore((state) => state.currentUser);
    const showToast = useAppStore((state) => state.showToast);
    const [mode, setMode] = useState(null); // 'camera', 'upload', 'manual'
    const [selectedFile, setSelectedFile] = useState(null);
    const [hasOcrKey, setHasOcrKey] = useState(null); // null=loading, true/false
    const fileInputRef = useRef(null);

    // Check if OCR API key is configured
    useEffect(() => {
        if (!addReceiptModalOpen || !currentUser?.userId) return;
        storageService.getOcrApiKey(currentUser.userId)
            .then(key => setHasOcrKey(!!key))
            .catch(() => setHasOcrKey(false));
    }, [addReceiptModalOpen, currentUser?.userId]);

    const handleClose = () => {
        setMode(null);
        setSelectedFile(null);
        setAddReceiptModalOpen(false);
    };

    const handleSave = async (receiptData) => {
        if (!currentUser) return;

        try {
            await storageService.createReceipt({
                ...receiptData,
                userId: currentUser.userId
            });
            showToast('Receipt saved successfully', 'success');
            handleClose();
            window.dispatchEvent(new CustomEvent('refreshReceipts'));
            window.dispatchEvent(new CustomEvent('refreshGroups'));
            window.dispatchEvent(new CustomEvent('refreshDashboard'));
        } catch (err) {
            showToast('Failed to save receipt', 'error');
        }
    };

    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setMode('upload');
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    if (mode === 'camera' || mode === 'upload') {
        return (
            <ErrorBoundary>
                <ReceiptUpload
                    isOpen={addReceiptModalOpen}
                    onClose={handleClose}
                    mode={mode}
                    initialFile={selectedFile}
                    onSwitchToManual={() => setMode('manual')}
                />
            </ErrorBoundary>
        );
    }

    if (mode === 'manual') {
        return (
            <ErrorBoundary>
                <Modal
                    isOpen={addReceiptModalOpen}
                    onClose={handleClose}
                    title="Add Receipt Manually"
                    size="lg"
                >
                    <ReceiptForm onSave={handleSave} onClose={handleClose} />
                </Modal>
            </ErrorBoundary>
        );
    }

    const ocrDisabled = hasOcrKey === false;
    const ocrButtonClass = (disabled) =>
        `w-full flex items-center gap-4 p-4 border-2 rounded-lg transition-colors ${
            disabled
                ? 'border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed'
                : 'border-gray-200 dark:border-gray-600 hover:border-primary-500 dark:hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900'
        }`;

    return (
        <Modal
            isOpen={addReceiptModalOpen}
            onClose={handleClose}
            title="Add Receipt"
        >
            <div className="space-y-4">
                <button
                    onClick={ocrDisabled ? undefined : () => setMode('camera')}
                    disabled={ocrDisabled}
                    className={ocrButtonClass(ocrDisabled)}
                >
                    <div className="w-12 h-12 rounded-full flex items-center justify-center primary-bg">
                        <Camera size={24} className="primary-color" />
                    </div>
                    <div className="text-left">
                        <h3 className="font-medium text-gray-900 dark:text-white">Take Photo</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-300">Capture receipt with camera</p>
                    </div>
                </button>

                <button
                    onClick={ocrDisabled ? undefined : () => fileInputRef.current?.click()}
                    disabled={ocrDisabled}
                    className={ocrButtonClass(ocrDisabled)}
                >
                    <div className="w-12 h-12 rounded-full flex items-center justify-center primary-bg">
                        <Upload size={24} className="primary-color" />
                    </div>
                    <div className="text-left">
                        <h3 className="font-medium text-gray-900 dark:text-white">Upload Image</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-300">Select image from device</p>
                    </div>
                </button>

                {ocrDisabled && (
                    <div className="flex items-center gap-2 px-1 py-2 text-sm text-amber-700 dark:text-amber-400">
                        <AlertCircle size={16} className="flex-shrink-0" />
                        <span>Add your OCR API key in Settings to enable scanning.</span>
                    </div>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                />

                <button
                    onClick={() => setMode('manual')}
                    className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 dark:border-gray-600 rounded-lg hover:border-primary-500 dark:hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900 transition-colors"
                >
                    <div className="w-12 h-12 rounded-full flex items-center justify-center primary-bg">
                        <FileText size={24} className="primary-color" />
                    </div>
                    <div className="text-left">
                        <h3 className="font-medium text-gray-900 dark:text-white">Enter Manually</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-300">Type receipt details</p>
                    </div>
                </button>
            </div>
        </Modal>
    );
}
