import { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Loader } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { ocrApi } from '../../services/ocrApi';
import { storageService } from '../../services/storage';
import Modal from '../common/Modal';
import ReceiptForm from './ReceiptForm';

const MAX_OCR_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_OCR_IMAGE_DIMENSION = 2200;
const MIN_OCR_IMAGE_DIMENSION = 900;
const INITIAL_JPEG_QUALITY = 0.9;
const MIN_JPEG_QUALITY = 0.55;
const JPEG_QUALITY_STEP = 0.1;

const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const canvasToBlob = (canvas, quality) =>
    new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Unable to compress image'));
                return;
            }
            resolve(blob);
        }, 'image/jpeg', quality);
    });

const loadImageFromFile = (file) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);

        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };

        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Unable to load image for OCR'));
        };

        image.src = objectUrl;
    });

const optimizeImageForOcr = async (file) => {
    const originalSize = file.size;

    if (!file.type.startsWith('image/')) {
        return {
            file,
            originalSize,
            optimizedSize: originalSize,
            optimized: false
        };
    }

    const image = await loadImageFromFile(file);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const maxSourceDimension = Math.max(sourceWidth, sourceHeight);
    const scaleRatio = maxSourceDimension > MAX_OCR_IMAGE_DIMENSION
        ? MAX_OCR_IMAGE_DIMENSION / maxSourceDimension
        : 1;

    let width = Math.max(1, Math.round(sourceWidth * scaleRatio));
    let height = Math.max(1, Math.round(sourceHeight * scaleRatio));
    let quality = INITIAL_JPEG_QUALITY;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
        return {
            file,
            originalSize,
            optimizedSize: originalSize,
            optimized: false
        };
    }

    let outputBlob = null;
    let attempts = 0;

    while (attempts < 12) {
        canvas.width = width;
        canvas.height = height;
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        outputBlob = await canvasToBlob(canvas, quality);
        if (outputBlob.size <= MAX_OCR_IMAGE_BYTES) break;

        if (quality > MIN_JPEG_QUALITY) {
            quality = Math.max(MIN_JPEG_QUALITY, quality - JPEG_QUALITY_STEP);
        } else {
            const nextWidth = Math.round(width * 0.85);
            const nextHeight = Math.round(height * 0.85);
            if (Math.max(nextWidth, nextHeight) < MIN_OCR_IMAGE_DIMENSION) {
                break;
            }
            width = nextWidth;
            height = nextHeight;
        }

        attempts += 1;
    }

    if (!outputBlob) {
        return {
            file,
            originalSize,
            optimizedSize: originalSize,
            optimized: false
        };
    }

    const optimizedSize = outputBlob.size;
    const didResize = width !== sourceWidth || height !== sourceHeight;
    const didShrink = optimizedSize < originalSize;
    const needsTypeChange = file.type !== 'image/jpeg';

    if (!didResize && !didShrink && !needsTypeChange) {
        return {
            file,
            originalSize,
            optimizedSize: originalSize,
            optimized: false
        };
    }

    const fileBaseName = (file.name || 'receipt').replace(/\.[^/.]+$/, '');
    const optimizedFile = new File([outputBlob], `${fileBaseName}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now()
    });

    return {
        file: optimizedFile,
        originalSize,
        optimizedSize,
        optimized: true
    };
};

export default function ReceiptUpload({ isOpen, onClose, mode = 'camera', initialFile = null, onSwitchToManual }) {
    const currentUser = useAppStore((state) => state.currentUser);
    const showToast = useAppStore((state) => state.showToast);
    const setLoading = useAppStore((state) => state.setLoading);
    const loading = useAppStore((state) => state.loading);

    const [imagePreview, setImagePreview] = useState(null);
    const [ocrResult, setOcrResult] = useState(null);
    const [error, setError] = useState(null);
    const [optimizationInfo, setOptimizationInfo] = useState(null);
    const [initialFileProcessed, setInitialFileProcessed] = useState(false);
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
            // OCR scanning is premium-gated and requires a user API key
            let apiKey = null;
            try {
                apiKey = await storageService.getOcrApiKey(currentUser.userId);
            } catch (apiKeyError) {
                console.warn('[ReceiptUpload] Could not get API key:', apiKeyError);
            }

            const normalizedApiKey = (apiKey || '').trim();
            if (!normalizedApiKey) {
                throw new Error('OCR scanning is a premium feature. Add your premium OCR API key in Settings to continue.');
            }

            let fileToProcess = file;
            try {
                const optimized = await optimizeImageForOcr(file);
                fileToProcess = optimized.file;
                setOptimizationInfo(optimized);

                if (optimized.optimized && optimized.optimizedSize < optimized.originalSize) {
                    showToast(
                        `Image optimized: ${formatBytes(optimized.originalSize)} -> ${formatBytes(optimized.optimizedSize)}`,
                        'info'
                    );
                }
            } catch (optimizationError) {
                console.warn('[ReceiptUpload] Failed to optimize image, using original:', optimizationError);
                setOptimizationInfo(null);
            }

            const result = await ocrApi.processReceipt(fileToProcess, normalizedApiKey);
            setOcrResult(result);
        } catch (err) {
            console.error('[ReceiptUpload] OCR processing error:', err);
            setError(err.message || 'Failed to process receipt');
            showToast(err.message || 'Failed to process receipt', 'error');
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
            // Dispatch events to refresh components using hooks
            window.dispatchEvent(new CustomEvent('refreshReceipts'));
            window.dispatchEvent(new CustomEvent('refreshGroups'));
            window.dispatchEvent(new CustomEvent('refreshDashboard'));
        } catch (err) {
            showToast('Failed to save receipt', 'error');
        }
    };

    const handleClose = () => {
        stopCamera();
        setImagePreview(null);
        setOcrResult(null);
        setError(null);
        setOptimizationInfo(null);
        onClose();
    };

    const handleRetry = () => {
        setImagePreview(null);
        setOcrResult(null);
        setError(null);
        setOptimizationInfo(null);
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

    // Process initial file if provided (from AddReceiptModal file selection)
    useEffect(() => {
        if (isOpen && initialFile && !initialFileProcessed && mode === 'upload') {
            setInitialFileProcessed(true);
            
            // Show preview
            const reader = new FileReader();
            reader.onload = (e) => {
                setImagePreview(e.target.result);
            };
            reader.readAsDataURL(initialFile);
            
            // Process the image
            processImage(initialFile);
        }
    }, [isOpen, initialFile, initialFileProcessed, mode]);

    // Reset initialFileProcessed when modal closes
    useEffect(() => {
        if (!isOpen) {
            setInitialFileProcessed(false);
        }
    }, [isOpen]);

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
                        {optimizationInfo && (
                            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                <p className="text-xs text-blue-800">
                                    {optimizationInfo.optimized
                                        ? `Upload optimized for OCR: ${formatBytes(optimizationInfo.originalSize)} -> ${formatBytes(optimizationInfo.optimizedSize)}`
                                        : `Upload size: ${formatBytes(optimizationInfo.originalSize)}`}
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
