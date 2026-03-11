import { MERCHANT_CATEGORY_MAP, DEFAULT_CATEGORY, DEFAULT_CURRENCY } from '../utils/constants';
import { cleanText } from '../utils/helpers';

const OCR_ENDPOINTS = ['/api/ocr', '/api/ocr-proxy'];

const shouldRetryWithFallback = (status, message = '') => {
    if (!status) return true;
    if (status >= 500) return true;
    if (status === 404 || status === 405) return true;
    if (status === 403 && /origin not allowed/i.test(message)) return true;
    return false;
};

export const ocrApi = {
    async processReceipt(imageFile, apiKey = null) {
        try {
            console.log('[OCR] Processing receipt with invoice2data...', {
                fileSize: imageFile.size,
                fileName: imageFile.name
            });

            // Convert file to base64
            const base64File = await this.fileToBase64(imageFile);
            const payload = {
                file: base64File,
                fileName: imageFile.name || 'receipt.jpg',
                apiKey: apiKey || undefined
            };

            let lastError = null;

            for (let index = 0; index < OCR_ENDPOINTS.length; index += 1) {
                const endpoint = OCR_ENDPOINTS[index];
                const isLastEndpoint = index === OCR_ENDPOINTS.length - 1;

                try {
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload)
                    });

                    const { data, rawText } = await this.parseResponseBody(response);
                    console.log('[OCR] Response status:', response.status, response.statusText, endpoint);

                    if (!response.ok) {
                        const endpointError = this.buildEndpointError({
                            endpoint,
                            response,
                            data,
                            rawText
                        });

                        if (!isLastEndpoint && shouldRetryWithFallback(response.status, endpointError.message)) {
                            console.warn('[OCR] Endpoint failed, trying fallback:', endpoint, endpointError.message);
                            lastError = endpointError;
                            continue;
                        }

                        throw endpointError;
                    }

                    if (!data || typeof data !== 'object') {
                        const invalidResponseError = new Error('Server returned invalid response. Please try again or use a different image.');
                        if (!isLastEndpoint) {
                            console.warn('[OCR] Invalid response payload, trying fallback endpoint:', endpoint);
                            lastError = invalidResponseError;
                            continue;
                        }
                        throw invalidResponseError;
                    }

                    const normalizedData = this.normalizeOcrProviderResult(data);
                    console.log('[OCR] Success! Received data:', normalizedData);
                    return this.postProcessResult(normalizedData);
                } catch (error) {
                    lastError = error;
                    if (!isLastEndpoint && shouldRetryWithFallback(error.status, error.message)) {
                        console.warn('[OCR] Network or endpoint issue, trying fallback:', endpoint, error.message);
                        continue;
                    }
                    throw error;
                }
            }

            throw lastError || new Error('Failed to process receipt');
        } catch (error) {
            console.error('[OCR] Request failed:', error);
            if (error.message.startsWith('Failed to process receipt:')) throw error;
            throw new Error(`Failed to process receipt: ${error.message}`);
        }
    },

    async parseResponseBody(response) {
        const rawText = await response.text();

        if (!rawText) {
            return { data: null, rawText: '' };
        }

        const contentType = response.headers.get('content-type') || '';
        const maybeJson = contentType.includes('application/json') || this.isLikelyJson(rawText);

        if (!maybeJson) {
            return { data: null, rawText };
        }

        try {
            return { data: JSON.parse(rawText), rawText };
        } catch (error) {
            console.error('[OCR] Failed to parse JSON response:', rawText.substring(0, 200));
            return { data: null, rawText };
        }
    },

    isLikelyJson(text) {
        const trimmed = (text || '').trim();
        return trimmed.startsWith('{') || trimmed.startsWith('[');
    },

    buildEndpointError({ endpoint, response, data, rawText }) {
        const errorMessage = this.getErrorMessage({
            status: response.status,
            statusText: response.statusText,
            data,
            rawText
        });

        const error = new Error(errorMessage);
        error.status = response.status;
        error.endpoint = endpoint;
        return error;
    },

    getErrorMessage({ status, statusText, data, rawText }) {
        const serverError = typeof data?.error === 'string' ? data.error.trim() : '';
        const responsePreview = (rawText || '').trim();
        const isHtmlResponse = responsePreview.startsWith('<');

        if (status === 403 && /origin not allowed/i.test(serverError || responsePreview)) {
            return 'Origin not allowed by OCR endpoint. Add your app URL to ALLOWED_ORIGINS (or APP_URL) in deployment settings.';
        }

        if (status === 401) {
            return serverError || 'Invalid OCR API key. Please check your OCR.Space API key in Settings.';
        }

        if (status === 429) {
            return serverError || 'API rate limit exceeded. Please try again later.';
        }

        if (serverError) {
            return serverError;
        }

        if (responsePreview) {
            if (isHtmlResponse) {
                return 'OCR endpoint returned HTML instead of JSON. Check deployment routing for /api/ocr.';
            }
            return responsePreview.slice(0, 180);
        }

        return `API error (${status}): ${statusText || 'Request failed'}`;
    },

    normalizeOcrProviderResult(data) {
        if (!data || typeof data !== 'object') return data;

        const hasStructuredReceiptFields =
            Object.prototype.hasOwnProperty.call(data, 'merchant') ||
            Object.prototype.hasOwnProperty.call(data, 'total');

        if (hasStructuredReceiptFields || !Array.isArray(data.ParsedResults)) {
            return data;
        }

        const parsedText = data.ParsedResults
            .map((entry) => entry?.ParsedText || '')
            .join('\n')
            .trim();

        if (!parsedText) {
            return data;
        }

        return {
            merchant: this.extractMerchantFromText(parsedText),
            date: this.extractDateFromText(parsedText) || new Date().toISOString(),
            total: this.extractTotalFromText(parsedText),
            currency: this.extractCurrencyFromText(parsedText),
            category: DEFAULT_CATEGORY,
            lineItems: [],
            notes: parsedText.slice(0, 500),
            rawData: {
                provider: 'ocr.space',
                parsedText,
                response: data
            }
        };
    },

    extractMerchantFromText(text) {
        const lines = text
            .split('\n')
            .map((line) => cleanText(line || '').trim())
            .filter(Boolean);

        const skipPattern = /^(receipt|tax|vat|invoice|date|time|subtotal|total|amount|change|thank)/i;

        for (const line of lines.slice(0, 8)) {
            if (line.length < 2 || line.length > 60) continue;
            if (skipPattern.test(line)) continue;
            if (/\d{4,}/.test(line)) continue;
            return line;
        }

        return lines[0] || 'Unknown Merchant';
    },

    extractTotalFromText(text) {
        const lines = text
            .split('\n')
            .map((line) => (line || '').trim())
            .filter(Boolean);

        const totalKeywordPattern = /(grand\s*total|amount\s*due|total|totale|balance\s*due)/i;

        for (const line of lines) {
            if (!totalKeywordPattern.test(line)) continue;
            const amounts = this.extractAmountsFromLine(line);
            if (amounts.length > 0) return Math.max(...amounts);
        }

        let maxAmount = 0;
        for (const line of lines) {
            const amounts = this.extractAmountsFromLine(line);
            for (const amount of amounts) {
                if (amount > maxAmount && amount < 100000) {
                    maxAmount = amount;
                }
            }
        }

        return maxAmount;
    },

    extractAmountsFromLine(line) {
        const amountMatches = line.match(/(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})/g) || [];
        return amountMatches
            .map((value) => this.parseAmount(value))
            .filter((value) => Number.isFinite(value) && value > 0);
    },

    parseAmount(value) {
        const sanitized = (value || '').replace(/[^\d,.-]/g, '');
        const hasComma = sanitized.includes(',');
        const hasDot = sanitized.includes('.');

        let normalized = sanitized;
        if (hasComma && hasDot) {
            normalized = sanitized.lastIndexOf(',') > sanitized.lastIndexOf('.')
                ? sanitized.replace(/\./g, '').replace(',', '.')
                : sanitized.replace(/,/g, '');
        } else if (hasComma) {
            normalized = sanitized.replace(',', '.');
        }

        const parsed = Number.parseFloat(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    },

    extractDateFromText(text) {
        const patterns = [
            /\b(\d{4}[./-]\d{1,2}[./-]\d{1,2})\b/,
            /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (!match) continue;

            const parsedDate = this.parseDateValue(match[1]);
            if (parsedDate) return parsedDate;
        }

        return null;
    },

    parseDateValue(value) {
        const token = (value || '').trim();
        if (!token) return null;

        if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(token)) {
            const normalized = token.replace(/[./]/g, '-');
            const parsed = new Date(normalized);
            return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
        }

        if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(token)) {
            const [day, month, year] = token.split(/[./-]/);
            const normalizedYear = year.length === 2 ? `20${year}` : year;
            const parsed = new Date(`${normalizedYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
            return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
        }

        const fallback = new Date(token);
        return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
    },

    extractCurrencyFromText(text) {
        if (/(€|eur)\b/i.test(text)) return 'EUR';
        if (/\$\s*|\busd\b/i.test(text)) return 'USD';
        if (/(£|gbp)\b/i.test(text)) return 'GBP';
        return DEFAULT_CURRENCY;
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
