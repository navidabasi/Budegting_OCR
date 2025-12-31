// Vercel Serverless Function to proxy Veryfi API requests
// This solves the CORS issue by making requests server-side

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Get API credentials from request body
    const { apiKey, file } = req.body;

    if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
    }

    if (!file) {
        return res.status(400).json({ error: 'File is required' });
    }

    try {
        // Parse API key - format: CLIENT_ID:API_KEY or just API_KEY
        const apiKeyParts = apiKey.split(':');
        const clientId = apiKeyParts[0] || '';
        const apiKeyValue = apiKeyParts[1] || apiKeyParts[0] || apiKey;

        // Prepare headers for Veryfi API
        const headers = {
            'Accept': 'application/json'
        };

        // Add CLIENT-ID header if we have it
        if (clientId && apiKeyParts.length > 1) {
            headers['CLIENT-ID'] = clientId;
        }

        // Add AUTHORIZATION header
        headers['AUTHORIZATION'] = `apikey ${apiKeyValue}`;

        // Convert base64 file to buffer
        const fileBuffer = Buffer.from(file, 'base64');
        
        // Create multipart/form-data for Veryfi API
        // Using a simpler approach that works in Node.js
        const boundary = `----WebKitFormBoundary${Date.now()}`;
        const CRLF = '\r\n';
        
        let formDataBody = '';
        formDataBody += `--${boundary}${CRLF}`;
        formDataBody += `Content-Disposition: form-data; name="file"; filename="receipt.jpg"${CRLF}`;
        formDataBody += `Content-Type: image/jpeg${CRLF}`;
        formDataBody += CRLF;
        
        // Combine text and binary data
        const textPart = Buffer.from(formDataBody);
        const endBoundary = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
        const formDataBuffer = Buffer.concat([textPart, fileBuffer, endBoundary]);

        headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
        // Don't set Content-Length manually, let fetch handle it

        // Make request to Veryfi API
        const response = await fetch('https://api.veryfi.com/api/v8/partner/document', {
            method: 'POST',
            headers: headers,
            body: formDataBuffer
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            
            if (response.status === 401) {
                return res.status(401).json({ 
                    error: 'Invalid API key. Please check your Veryfi API credentials.' 
                });
            } else if (response.status === 429) {
                return res.status(429).json({ 
                    error: 'API rate limit exceeded. Please try again later.' 
                });
            } else {
                return res.status(response.status).json({ 
                    error: errorData.error_message || errorData.message || `API error: ${response.statusText}` 
                });
            }
        }

        const data = await response.json();
        return res.status(200).json(data);
    } catch (error) {
        console.error('Veryfi proxy error:', error);
        return res.status(500).json({ 
            error: `Failed to process receipt: ${error.message}` 
        });
    }
}

