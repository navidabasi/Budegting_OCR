export const veryfiApi = {
    async processReceipt(imageFile, apiKey) {
        if (!apiKey) {
            throw new Error('Veryfi API key is required. Please add it in Settings.');
        }

        try {
            console.log('[Veryfi API] Processing receipt via proxy...', {
                fileSize: imageFile.size,
                fileName: imageFile.name
            });

            // Convert file to base64 for sending to proxy
            const base64File = await this.fileToBase64(imageFile);

            // Use proxy endpoint to avoid CORS issues
            // In development, use local proxy; in production, use Vercel function
            const proxyUrl = import.meta.env.DEV 
                ? '/api/veryfi-proxy'  // Local dev (if using Vite proxy)
                : '/api/veryfi-proxy'; // Production (Vercel serverless function)

            const response = await fetch(proxyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    apiKey: apiKey,
                    file: base64File
                })
            });

            console.log('[Veryfi API] Proxy response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                
                if (response.status === 401) {
                    throw new Error('Invalid API key. Please check your Veryfi API credentials (CLIENT_ID:API_KEY format).');
                } else if (response.status === 403) {
                    throw new Error('Access forbidden. Please check your API key permissions in Veryfi dashboard.');
                } else if (response.status === 429) {
                    throw new Error('API rate limit exceeded. Please try again later.');
                } else {
                    throw new Error(errorData.error || errorData.error_message || `API error (${response.status}): ${response.statusText}`);
                }
            }

            const data = await response.json();
            console.log('[Veryfi API] Success! Received data:', data);
            return this.parseVeryfiResponse(data);
        } catch (error) {
            console.error('[Veryfi API] Request failed:', error);
            
            if (error.message.includes('API key') || 
                error.message.includes('rate limit') || 
                error.message.includes('forbidden')) {
                throw error;
            }
            
            throw new Error(`Failed to process receipt: ${error.message}`);
        }
    },

    // Helper function to convert file to base64
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // Remove data URL prefix (data:image/jpeg;base64,)
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    parseVeryfiResponse(data) {
        const receipt = {
            merchant: data.vendor?.name || data.vendor_name || 'Unknown Merchant',
            date: data.date || new Date().toISOString(),
            total: parseFloat(data.total || data.subtotal || 0),
            category: this.suggestCategory(data.vendor?.name || data.vendor_name || ''),
            lineItems: [],
            notes: data.notes || '',
            rawData: data
        };

        // Parse line items
        if (data.line_items && Array.isArray(data.line_items)) {
            receipt.lineItems = data.line_items.map(item => ({
                name: item.description || item.name || 'Unknown Item',
                quantity: parseFloat(item.quantity || 1),
                price: parseFloat(item.price || item.total || 0),
                category: this.suggestCategory(item.description || item.name || '')
            }));
        }

        // If no line items, create one from total
        if (receipt.lineItems.length === 0 && receipt.total > 0) {
            receipt.lineItems.push({
                name: 'Total',
                quantity: 1,
                price: receipt.total,
                category: receipt.category
            });
        }

        return receipt;
    },

    suggestCategory(merchantName) {
        if (!merchantName) return 'Other';

        const lowerName = merchantName.toLowerCase();
        const { MERCHANT_CATEGORY_MAP, DEFAULT_CATEGORY } = require('../utils/constants');

        for (const [keyword, category] of Object.entries(MERCHANT_CATEGORY_MAP)) {
            if (lowerName.includes(keyword)) {
                return category;
            }
        }

        return DEFAULT_CATEGORY;
    }
};

