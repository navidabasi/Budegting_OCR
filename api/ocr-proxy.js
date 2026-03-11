// Vercel Serverless Function to proxy OCR.Space API requests
// This solves potential CORS issues by making requests server-side

const DEFAULT_ALLOWED_ORIGINS = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]);

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_REQUEST_BYTES = parsePositiveInt(process.env.MAX_OCR_REQUEST_BYTES, 12 * 1024 * 1024);
const OCR_RATE_LIMIT_REQUESTS = parsePositiveInt(process.env.OCR_RATE_LIMIT_REQUESTS, 30);
const OCR_RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.OCR_RATE_LIMIT_WINDOW_SECONDS, 60) * 1000;
const OCR_SPACE_SERVER_API_KEY = process.env.OCR_SPACE_API_KEY || '';
const ALLOW_VERCEL_PREVIEWS = (process.env.ALLOW_VERCEL_PREVIEWS || '').toLowerCase() === 'true';
const rateLimitStore = new Map();

const allowedOrigins = (() => {
    const configured = new Set(
        (process.env.ALLOWED_ORIGINS || '')
            .split(',')
            .map((origin) => origin.trim().replace(/\/$/, ''))
            .filter(Boolean)
    );
    const appUrl = (process.env.APP_URL || '').trim().replace(/\/$/, '');
    if (appUrl) configured.add(appUrl);
    return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
})();

const normalizeOrigin = (origin) => (origin || '').trim().replace(/\/$/, '');
const normalizeHost = (host) => (host || '').trim().toLowerCase();

const getOriginHost = (origin) => {
    try {
        return normalizeHost(new URL(origin).host);
    } catch {
        return '';
    }
};

const isOriginAllowed = (origin, requestHost = '') => {
    if (!origin) return true;

    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.has(normalized)) return true;

    const originHost = getOriginHost(normalized);
    const normalizedRequestHost = normalizeHost(requestHost);
    if (originHost && normalizedRequestHost && originHost === normalizedRequestHost) {
        return true;
    }

    return (
        ALLOW_VERCEL_PREVIEWS &&
        normalized.startsWith('https://') &&
        normalized.endsWith('.vercel.app')
    );
};

const applyCorsHeaders = (res, origin) => {
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
};

const getClientIdentifier = (req) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
        return forwardedFor.split(',')[0].trim();
    }
    return req.headers['x-real-ip'] || 'unknown';
};

const isRateLimited = (clientId) => {
    const now = Date.now();

    for (const [key, value] of rateLimitStore.entries()) {
        if (now >= value.resetAt) {
            rateLimitStore.delete(key);
        }
    }

    const entry = rateLimitStore.get(clientId);

    if (!entry || now >= entry.resetAt) {
        rateLimitStore.set(clientId, { count: 1, resetAt: now + OCR_RATE_LIMIT_WINDOW_MS });
        return false;
    }

    entry.count += 1;
    if (entry.count > OCR_RATE_LIMIT_REQUESTS) {
        return true;
    }

    return false;
};

export default async function handler(req, res) {
    const requestOrigin = normalizeOrigin(req.headers.origin);
    if (!isOriginAllowed(requestOrigin, req.headers.host || '')) {
        return res.status(403).json({ error: 'Origin not allowed' });
    }
    applyCorsHeaders(res, requestOrigin);

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // Test endpoint - GET request to verify function is working
    if (req.method === 'GET') {
        return res.status(200).json({
            message: 'OCR.Space proxy is working!',
            timestamp: new Date().toISOString()
        });
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const clientId = getClientIdentifier(req);
    if (isRateLimited(clientId)) {
        return res.status(429).json({ error: 'Too many OCR requests. Please try again later.' });
    }

    let body;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch {
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    // Get data from request body
    const { apiKey, file, fileName } = body;

    if (!file || typeof file !== 'string') {
        return res.status(400).json({ error: 'File is required' });
    }

    try {
        const maxBase64Length = Math.ceil((MAX_REQUEST_BYTES * 4) / 3) + 1024;
        if (file.length > maxBase64Length) {
            return res.status(413).json({ error: 'Request payload too large' });
        }

        const normalizedBase64 = file.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedBase64)) {
            return res.status(400).json({ error: 'Invalid base64 file payload' });
        }

        // Convert base64 to buffer
        const fileBuffer = Buffer.from(normalizedBase64, 'base64');
        if (fileBuffer.length > MAX_REQUEST_BYTES) {
            return res.status(413).json({ error: 'Decoded file is too large' });
        }

        // Determine file type from fileName or default to jpeg
        let mimeType = 'image/jpeg';
        const safeFileName = (fileName || 'receipt.jpg').replace(/[\r\n"]/g, '');
        if (safeFileName) {
            const ext = safeFileName.toLowerCase().split('.').pop();
            const mimeTypes = {
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'bmp': 'image/bmp',
                'pdf': 'application/pdf'
            };
            mimeType = mimeTypes[ext] || 'image/jpeg';
        }

        // Create multipart/form-data for OCR.Space API
        const boundary = `----WebKitFormBoundary${Date.now()}`;
        const CRLF = '\r\n';
        
        // Build form data parts
        let formParts = [];

        // API Key is required from user or server configuration
        const actualApiKey = apiKey || OCR_SPACE_SERVER_API_KEY;
        if (!actualApiKey) {
            return res.status(400).json({
                error: 'OCR API key is required. Add one in Settings or configure OCR_SPACE_API_KEY on the server.'
            });
        }
        formParts.push(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="apikey"${CRLF}${CRLF}` +
            `${actualApiKey}${CRLF}`
        );
        
        // Language
        formParts.push(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="language"${CRLF}${CRLF}` +
            `eng${CRLF}`
        );
        
        // OCR Engine (Engine 2 is better for receipts)
        formParts.push(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="OCREngine"${CRLF}${CRLF}` +
            `2${CRLF}`
        );
        
        // Detect orientation
        formParts.push(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="detectOrientation"${CRLF}${CRLF}` +
            `true${CRLF}`
        );
        
        // Scale
        formParts.push(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="scale"${CRLF}${CRLF}` +
            `true${CRLF}`
        );
        
        // isTable (helps with receipt parsing)
        formParts.push(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="isTable"${CRLF}${CRLF}` +
            `true${CRLF}`
        );
        
        // isOverlayRequired (returns bounding boxes for better parsing)
        formParts.push(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="isOverlayRequired"${CRLF}${CRLF}` +
            `true${CRLF}`
        );
        
        // File header
        const fileHeader =
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="file"; filename="${safeFileName}"${CRLF}` +
            `Content-Type: ${mimeType}${CRLF}${CRLF}`;

        // End boundary
        const endBoundary = `${CRLF}--${boundary}--${CRLF}`;

        // Combine all parts
        const textParts = Buffer.from(formParts.join('') + fileHeader);
        const endPart = Buffer.from(endBoundary);
        const formDataBuffer = Buffer.concat([textParts, fileBuffer, endPart]);

        // Make request to OCR.Space API
        const response = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body: formDataBuffer
        });

        const data = await response.json();

        // Check for OCR.Space specific errors
        if (data.IsErroredOnProcessing) {
            return res.status(400).json({
                error: data.ErrorMessage?.[0] || 'Failed to process image',
                OCRExitCode: data.OCRExitCode
            });
        }

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                return res.status(401).json({
                    error: 'Invalid API key. Please check your OCR.Space API key.'
                });
            } else if (response.status === 429) {
                return res.status(429).json({
                    error: 'API rate limit exceeded. Please try again later or add an API key.'
                });
            } else {
                return res.status(response.status).json({
                    error: data.ErrorMessage?.[0] || data.error || `API error: ${response.statusText}`
                });
            }
        }

        return res.status(200).json(data);
    } catch (error) {
        console.error('[OCR Proxy] Error:', error);
        return res.status(500).json({
            error: 'Failed to process receipt'
        });
    }
}
