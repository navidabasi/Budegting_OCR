// Image optimiser for receipts (moved from the old ReceiptUpload; same algorithm).
export const DEFAULT_MAX_BYTES = 3 * 1024 * 1024; // base64 + JSON must stay under Vercel's 4.5 MB body limit
const MAX_OCR_IMAGE_DIMENSION = 2200;
const MIN_OCR_IMAGE_DIMENSION = 900;
const INITIAL_JPEG_QUALITY = 0.9;
const MIN_JPEG_QUALITY = 0.55;
const JPEG_QUALITY_STEP = 0.1;

export const formatBytes = (bytes) => {
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

/** Resize/compress an image to JPEG (<= maxBytes, <= 2200 px). Non-images are returned untouched. */
export const optimizeImage = async (file, { maxBytes = DEFAULT_MAX_BYTES, forceReencode = false } = {}) => {
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
        if (outputBlob.size <= maxBytes) break;

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

    // forceReencode: the canvas output always replaces the original, so EXIF/GPS metadata never survives (pass 2 section 7)
    if (!forceReencode && !didResize && !didShrink && !needsTypeChange) {
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

/**
 * Crop a photo to the part inside the given trims (fractions 0..0.9 of each side) and re-encode it as JPEG via canvas, which
 * also drops all metadata. Returns the cropped File, or the original when there is nothing to trim or no canvas.
 */
export async function cropImage(file, { top = 0, bottom = 0, left = 0, right = 0 } = {}) {
    const clamp = (n) => Math.min(0.9, Math.max(0, Number(n) || 0));
    const [t, b, l, r] = [clamp(top), clamp(bottom), clamp(left), clamp(right)];
    if (!file.type?.startsWith('image/') || (t + b + l + r === 0 && file.type === 'image/jpeg')) return file;
    const image = await loadImageFromFile(file);
    const sw = image.naturalWidth || image.width;
    const sh = image.naturalHeight || image.height;
    const x = Math.round(sw * l);
    const y = Math.round(sh * t);
    const w = Math.max(1, Math.round(sw * (1 - l - r)));
    const h = Math.max(1, Math.round(sh * (1 - t - b)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
    const blob = await canvasToBlob(canvas, INITIAL_JPEG_QUALITY);
    const base = (file.name || 'receipt').replace(/\.[^/.]+$/, '');
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}
