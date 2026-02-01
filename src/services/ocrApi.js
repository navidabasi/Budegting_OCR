import { MERCHANT_CATEGORY_MAP, DEFAULT_CATEGORY, DEFAULT_CURRENCY } from '../utils/constants';
import { cleanText } from '../utils/helpers';

export const ocrApi = {
    async processReceipt(imageFile, apiKey = null) {
        try {
            console.log('[OCR] Processing receipt with invoice2data...', {
                fileSize: imageFile.size,
                fileName: imageFile.name
            });

            // Convert file to base64
            const base64File = await this.fileToBase64(imageFile);

            // Call the Python invoice2data endpoint
            const response = await fetch('/api/ocr', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    file: base64File,
                    fileName: imageFile.name || 'receipt.jpg'
                })
            });

            console.log('[OCR] Response status:', response.status, response.statusText);

            // Parse response
            let data;
            const responseText = await response.text();

            try {
                data = JSON.parse(responseText);
            } catch (parseError) {
                console.error('[OCR] Failed to parse response:', responseText.substring(0, 200));
                throw new Error('Server returned invalid response. Please try again or use a different image.');
            }

            if (!response.ok) {
                if (response.status === 429) {
                    throw new Error('API rate limit exceeded. Please try again later.');
                }
                throw new Error(data.error || `API error (${response.status}): ${response.statusText}`);
            }

            console.log('[OCR] Success! Received data:', data);

            // Post-process the result
            return this.postProcessResult(data);
        } catch (error) {
            console.error('[OCR] Request failed:', error);

            if (error.message.includes('rate limit')) {
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

    // Post-process the invoice2data result
    postProcessResult(data) {
        const result = {
            merchant: data.merchant || 'Unknown Merchant',
            date: data.date || new Date().toISOString(),
            total: data.total || 0,
            currency: data.currency || DEFAULT_CURRENCY,
            category: data.category || DEFAULT_CATEGORY,
            lineItems: data.lineItems || [],
            notes: data.notes || '',
            rawData: data.rawData || {}
        };

        // Clean merchant name
        if (result.merchant !== 'Unknown Merchant') {
            result.merchant = cleanText(result.merchant);
        }

        // Suggest category based on merchant
        if (result.merchant && result.merchant !== 'Unknown Merchant') {
            result.category = this.suggestCategory(result.merchant);
        }

        // Add categories to line items
        result.lineItems = result.lineItems.map(item => ({
            ...item,
            name: cleanText(item.name || 'Item'),
            quantity: item.quantity || 1,
            price: item.price || 0,
            category: item.category || this.suggestCategory(item.name) || result.category
        }));

        // If no line items but have total, create one item
        if (result.lineItems.length === 0 && result.total > 0) {
            result.lineItems.push({
                name: 'Total',
                quantity: 1,
                price: result.total,
                category: result.category
            });
        }

        console.log('[OCR] Post-processed result:', result);
        return result;
    },

    suggestCategory(text) {
        if (!text) return DEFAULT_CATEGORY;

        const lowerText = text.toLowerCase();

        for (const [keyword, category] of Object.entries(MERCHANT_CATEGORY_MAP)) {
            if (lowerText.includes(keyword)) {
                return category;
            }
        }

        return DEFAULT_CATEGORY;
    }
};
