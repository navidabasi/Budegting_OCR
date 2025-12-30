export const veryfiApi = {
    async processReceipt(imageFile, apiKey) {
        if (!apiKey) {
            throw new Error('Veryfi API key is required. Please add it in Settings.');
        }

        const formData = new FormData();
        formData.append('file', imageFile);

        try {
            const response = await fetch('https://api.veryfi.com/api/v8/partner/document', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'CLIENT-ID': apiKey.split(':')[0] || '',
                    'AUTHORIZATION': `apikey ${apiKey.split(':')[1] || apiKey}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (response.status === 401) {
                    throw new Error('Invalid API key. Please check your Veryfi API credentials.');
                } else if (response.status === 429) {
                    throw new Error('API rate limit exceeded. Please try again later.');
                } else {
                    throw new Error(errorData.error_message || `API error: ${response.statusText}`);
                }
            }

            const data = await response.json();
            return this.parseVeryfiResponse(data);
        } catch (error) {
            if (error.message.includes('API key') || error.message.includes('rate limit')) {
                throw error;
            }
            throw new Error(`Failed to process receipt: ${error.message}`);
        }
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

