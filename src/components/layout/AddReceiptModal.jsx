import { useState, useRef } from 'react';
import { Camera, Upload, FileText, X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { storageService } from '../../services/storage';
import Modal from '../common/Modal';
import ReceiptForm from '../receipts/ReceiptForm';
import ReceiptUpload from '../receipts/ReceiptUpload';

export default function AddReceiptModal() {
    const addReceiptModalOpen = useAppStore((state) => state.addReceiptModalOpen);
    const setAddReceiptModalOpen = useAppStore((state) => state.setAddReceiptModalOpen);
    const currentUser = useAppStore((state) => state.currentUser);
    const showToast = useAppStore((state) => state.showToast);
    const [mode, setMode] = useState(null); // 'camera', 'upload', 'manual'
    const [selectedFile, setSelectedFile] = useState(null);
    const fileInputRef = useRef(null);

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
            // Dispatch events to refresh components using hooks
            window.dispatchEvent(new CustomEvent('refreshReceipts'));
            window.dispatchEvent(new CustomEvent('refreshGroups'));
            window.dispatchEvent(new CustomEvent('refreshDashboard'));
        } catch (err) {
            showToast('Failed to save receipt', 'error');
        }
    };

    const handleCameraClick = () => {
        setMode('camera');
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setMode('upload');
        }
        // Reset input so the same file can be selected again if needed
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleManualClick = () => {
        setMode('manual');
    };

    if (mode === 'camera' || mode === 'upload') {
        return (
            <ReceiptUpload
                isOpen={addReceiptModalOpen}
                onClose={handleClose}
                mode={mode}
                initialFile={selectedFile}
                onSwitchToManual={handleManualClick}
            />
        );
    }

    if (mode === 'manual') {
        return (
            <Modal
                isOpen={addReceiptModalOpen}
                onClose={handleClose}
                title="Add Receipt Manually"
                size="lg"
            >
                <ReceiptForm onSave={handleSave} onClose={handleClose} />
            </Modal>
        );
    }

    return (
        <Modal
            isOpen={addReceiptModalOpen}
            onClose={handleClose}
            title="Add Receipt"
        >
            <div className="space-y-4">
                <button
                    onClick={handleCameraClick}
                    className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 dark:border-gray-600 rounded-lg hover:border-primary-500 dark:hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900 transition-colors"
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
                    onClick={handleUploadClick}
                    className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 dark:border-gray-600 rounded-lg hover:border-primary-500 dark:hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900 transition-colors"
                >
                    <div className="w-12 h-12 rounded-full flex items-center justify-center primary-bg">
                        <Upload size={24} className="primary-color" />
                    </div>
                    <div className="text-left">
                        <h3 className="font-medium text-gray-900 dark:text-white">Upload Image</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-300">Select image from device</p>
                    </div>
                </button>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                />

                <button
                    onClick={handleManualClick}
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

