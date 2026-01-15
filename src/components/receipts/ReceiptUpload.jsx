import { useState, useRef, useEffect } from 'react';
import { Camera, Upload, X, Loader } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { ocrApi } from '../../services/ocrApi';
import { storageService } from '../../services/storage';
import Modal from '../common/Modal';
import ReceiptForm from './ReceiptForm';

export default function ReceiptUpload({ isOpen, onClose, mode = 'camera', onSwitchToManual }) {
    const currentUser = useAppStore((state) => state.currentUser);
    const showToast = useAppStore((state) => state.showToast);
    const setLoading = useAppStore((state) => state.setLoading);
    const loading = useAppStore((state) => state.loading);

    const [imagePreview, setImagePreview] = useState(null);
    const [ocrResult, setOcrResult] = useState(null);
    const [error, setError] = useState(null);
    const videoRef = useRef(null);
    const fileInputRef = useRef(null);
    const streamRef = useRef(null);

    const handleFileSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            setImagePreview(e.target.result);
        };
        reader.readAsDataURL(file);
        await processImage(file);
    };

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (err) {
            setError('Camera access denied. Please allow camera permissions.');
            showToast('Camera access denied', 'error');
        }
    };

    const capturePhoto = async () => {
        if (!videoRef.current) return;

        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0);

        canvas.toBlob(async (blob) => {
            if (blob) {
                const file = new File([blob], 'receipt.jpg', { type: 'image/jpeg' });
                setImagePreview(URL.createObjectURL(blob));
                stopCamera();
                await processImage(file);
            }
        }, 'image/jpeg');
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    };

    const processImage = async (file) => {
        if (!currentUser) return;

        setLoading(true);
        setError(null);

        try {
            // API key is optional for OCR.Space (free tier works without it)
            const apiKey = await storageService.getOcrApiKey(currentUser.userId);

            const result = await ocrApi.processReceipt(file, apiKey);
            setOcrResult(result);
        } catch (err) {
            setError(err.message);
            showToast(err.message, 'error');
        } finally {
            setLoading(false);
        }
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
        } catch (err) {
            showToast('Failed to save receipt', 'error');
        }
    };

    const handleClose = () => {
        stopCamera();
        setImagePreview(null);
        setOcrResult(null);
        setError(null);
        onClose();
    };

    const handleRetry = () => {
        setImagePreview(null);
        setOcrResult(null);
        setError(null);
        if (mode === 'camera') {
            startCamera();
        } else {
            fileInputRef.current?.click();
        }
    };

    // Start camera when modal opens in camera mode
    useEffect(() => {
        if (isOpen && mode === 'camera') {
            startCamera();
        }
        return () => {
            stopCamera();
        };
    }, [isOpen, mode]);

    if (ocrResult) {
        return (
            <Modal isOpen={isOpen} onClose={handleClose} title="Review Receipt" size="lg">
                <ReceiptForm
                    initialData={ocrResult}
                    onSave={handleSave}
                    onClose={handleClose}
                />
            </Modal>
        );
    }

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title={mode === 'camera' ? 'Take Photo' : 'Upload Receipt'}>
            <div className="space-y-4">
                {mode === 'camera' && !imagePreview && (
                    <div className="space-y-4">
                        <div className="relative bg-gray-100 rounded-lg overflow-hidden aspect-video">
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                className="w-full h-full object-cover"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={capturePhoto}
                                className="flex-1 btn btn-primary"
                                disabled={loading}
                            >
                                <Camera className="inline mr-2" size={20} />
                                Capture
                            </button>
                            <button
                                onClick={handleClose}
                                className="btn btn-secondary"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {mode === 'upload' && !imagePreview && (
                    <div className="space-y-4">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleFileSelect}
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full btn btn-primary"
                        >
                            <Upload className="inline mr-2" size={20} />
                            Select Image
                        </button>
                    </div>
                )}

                {imagePreview && (
                    <div className="space-y-4">
                        <div className="relative">
                            <img
                                src={imagePreview}
                                alt="Receipt preview"
                                className="w-full rounded-lg"
                            />
                            {loading && (
                                <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center rounded-lg">
                                    <Loader className="animate-spin text-white" size={32} />
                                </div>
                            )}
                        </div>
                        {error && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                <p className="text-sm text-red-800 font-medium">{error}</p>
                                <p className="text-xs text-red-600 mt-2">
                                    {error.includes('rate limit') ? (
                                        <>
                                            <strong>Tip:</strong> Add an OCR.Space API key in Settings for higher limits.
                                        </>
                                    ) : (
                                        'You can still add this receipt manually.'
                                    )}
                                </p>
                            </div>
                        )}
                        <div className="flex gap-2">
                            {error && (
                                <button
                                    onClick={() => {
                                        handleClose();
                                        if (onSwitchToManual) {
                                            onSwitchToManual();
                                        }
                                    }}
                                    className="flex-1 btn btn-primary"
                                >
                                    Enter Manually
                                </button>
                            )}
                            <button
                                onClick={handleRetry}
                                className={`${error ? 'flex-1' : 'flex-1'} btn btn-secondary`}
                                disabled={loading}
                            >
                                Retry
                            </button>
                            <button
                                onClick={handleClose}
                                className="btn btn-secondary"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}

