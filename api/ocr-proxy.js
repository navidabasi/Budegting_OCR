// Vercel Serverless Function to proxy OCR.Space API requests
// This solves potential CORS issues by making requests server-side

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
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

    // Get data from request body
    const { apiKey, file, fileName } = req.body;

    if (!file) {
        return res.status(400).json({ error: 'File is required' });
    }

    try {
        console.log('[OCR Proxy] Processing request...', {
            hasApiKey: !!apiKey,
            fileSize: file.length,
            fileName: fileName || 'receipt.jpg'
        });

        // Convert base64 to buffer
        const fileBuffer = Buffer.from(file, 'base64');
        
        // Determine file type from fileName or default to jpeg
        let mimeType = 'image/jpeg';
        if (fileName) {
            const ext = fileName.toLowerCase().split('.').pop();
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
        
        // API Key (use free tier test key if not provided)
        const actualApiKey = apiKey || 'helloworld'; // 'helloworld' is OCR.Space's free tier test key
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
            `Content-Disposition: form-data; name="file"; filename="${fileName || 'receipt.jpg'}"${CRLF}` +
            `Content-Type: ${mimeType}${CRLF}${CRLF}`;
        
        // End boundary
        const endBoundary = `${CRLF}--${boundary}--${CRLF}`;
        
        // Combine all parts
        const textParts = Buffer.from(formParts.join('') + fileHeader);
        const endPart = Buffer.from(endBoundary);
        const formDataBuffer = Buffer.concat([textParts, fileBuffer, endPart]);

        console.log('[OCR Proxy] Sending request to OCR.Space...', {
            endpoint: 'https://api.ocr.space/parse/image',
            contentType: `multipart/form-data; boundary=${boundary}`,
            bufferSize: formDataBuffer.length
        });

        // Make request to OCR.Space API
        const response = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body: formDataBuffer
        });

        console.log('[OCR Proxy] OCR.Space response:', {
            status: response.status,
            statusText: response.statusText
        });

        const data = await response.json();
        
        // Check for OCR.Space specific errors
        if (data.IsErroredOnProcessing) {
            console.error('[OCR Proxy] OCR.Space processing error:', data.ErrorMessage);
            return res.status(400).json({
                error: data.ErrorMessage?.[0] || 'Failed to process image',
                OCRExitCode: data.OCRExitCode
            });
        }

        if (!response.ok) {
            console.error('[OCR Proxy] OCR.Space API error:', data);
            
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

        console.log('[OCR Proxy] Success! OCR completed.');
        return res.status(200).json(data);
    } catch (error) {
        console.error('[OCR Proxy] Error:', error);
        return res.status(500).json({ 
            error: `Failed to process receipt: ${error.message}` 
        });
    }
}

