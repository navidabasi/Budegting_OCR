// Vercel Serverless Function to proxy Veryfi API requests
// This solves the CORS issue by making requests server-side

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
            message: 'Veryfi proxy is working!',
            timestamp: new Date().toISOString()
        });
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
        // Parse API key - format: CLIENT_ID:API_KEY or USERNAME:API_KEY
        const apiKeyParts = apiKey.split(':');
        const firstPart = apiKeyParts[0] || ''; // Could be CLIENT_ID or USERNAME
        const apiKeyValue = apiKeyParts[1] || apiKeyParts[0] || apiKey;

        // Prepare headers for Veryfi API
        const headers = {
            'Accept': 'application/json'
        };

        // Add CLIENT-ID header (required)
        if (firstPart && apiKeyParts.length > 1) {
            headers['CLIENT-ID'] = firstPart;
        }

        // Add AUTHORIZATION header
        // Veryfi expects: apikey USERNAME:API_KEY or apikey CLIENT_ID:API_KEY
        // Since user provided CLIENT_ID:API_KEY, we'll use that format
        if (apiKeyParts.length > 1) {
            headers['AUTHORIZATION'] = `apikey ${firstPart}:${apiKeyValue}`;
        } else {
            headers['AUTHORIZATION'] = `apikey ${apiKeyValue}`;
        }

        // Convert base64 file to buffer
        const fileBuffer = Buffer.from(file, 'base64');
        
        // Create multipart/form-data for Veryfi API
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

        console.log('[Veryfi Proxy] Making request to Veryfi API...', {
            hasClientId: !!clientId,
            clientIdLength: clientId.length,
            hasApiKey: !!apiKeyValue,
            apiKeyLength: apiKeyValue.length,
            fileSize: fileBuffer.length,
            endpoint: 'https://api.veryfi.com/api/v8/partner/document'
        });

        // Make request to Veryfi API
        // Try both singular and plural endpoints
        let veryfiUrl = 'https://api.veryfi.com/api/v8/partner/documents';
        
        console.log('[Veryfi Proxy] Request headers:', {
            'CLIENT-ID': headers['CLIENT-ID'] ? 'Set' : 'Missing',
            'AUTHORIZATION': headers['AUTHORIZATION'] ? 'Set' : 'Missing',
            'Content-Type': headers['Content-Type']
        });
        
        const response = await fetch(veryfiUrl, {
            method: 'POST',
            headers: headers,
            body: formDataBuffer
        });

        console.log('[Veryfi Proxy] Veryfi API response:', {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries())
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[Veryfi Proxy] Veryfi API error:', errorData);
            
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
        console.log('[Veryfi Proxy] Success!');
        return res.status(200).json(data);
    } catch (error) {
        console.error('[Veryfi Proxy] Error:', error);
        return res.status(500).json({ 
            error: `Failed to process receipt: ${error.message}` 
        });
    }
}

