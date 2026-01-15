import { MERCHANT_CATEGORY_MAP, DEFAULT_CATEGORY, DEFAULT_CURRENCY } from '../utils/constants';
import { cleanText, parseLocalNumber, extractDateFromText, extractPricesFromText } from '../utils/helpers';

export const ocrApi = {
    async processReceipt(imageFile, apiKey = null) {
        try {
            console.log('[OCR.Space] Processing receipt...', {
                fileSize: imageFile.size,
                fileName: imageFile.name
            });

            // Try direct API call first (works in production and may work in dev)
            // Fall back to proxy if direct call fails due to CORS
            let data;

            try {
                data = await this.callOcrSpaceDirect(imageFile, apiKey);
            } catch (directError) {
                console.log('[OCR.Space] Direct call failed, trying proxy...', directError.message);

                // Try proxy as fallback
                try {
                    data = await this.callOcrSpaceViaProxy(imageFile, apiKey);
                } catch (proxyError) {
                    // If both fail, throw the more descriptive error
                    throw new Error(directError.message.includes('CORS') || directError.message.includes('Failed to fetch')
                        ? proxyError.message
                        : directError.message);
                }
            }

            console.log('[OCR.Space] Success! Received data:', data);

            // Check for errors in response
            if (data.OCRExitCode !== 1) {
                throw new Error(data.ErrorMessage?.[0] || 'Failed to extract text from image');
            }

            return this.parseOcrSpaceResponse(data);
        } catch (error) {
            console.error('[OCR.Space] Request failed:', error);

            if (error.message.includes('API key') ||
                error.message.includes('rate limit') ||
                error.message.includes('forbidden')) {
                throw error;
            }

            throw new Error(`Failed to process receipt: ${error.message}`);
        }
    },

    // Direct call to OCR.Space API (may fail due to CORS in browser)
    async callOcrSpaceDirect(imageFile, apiKey) {
        const formData = new FormData();
        formData.append('apikey', apiKey || 'helloworld'); // helloworld is free tier test key
        formData.append('language', 'eng');
        formData.append('OCREngine', '2');
        formData.append('detectOrientation', 'true');
        formData.append('scale', 'true');
        formData.append('isTable', 'true');
        formData.append('file', imageFile);

        const response = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 401 || response.status === 403) {
                throw new Error('Invalid API key. Please check your OCR.Space API key in Settings.');
            } else if (response.status === 429) {
                throw new Error('API rate limit exceeded. Please try again later.');
            }
            throw new Error(`OCR API error: ${response.status} - ${errorText}`);
        }

        return await response.json();
    },

    // Call via Vercel proxy (for production or when direct call fails)
    async callOcrSpaceViaProxy(imageFile, apiKey) {
        const base64File = await this.fileToBase64(imageFile);
        const proxyUrl = '/api/ocr-proxy';

        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                apiKey: apiKey || '',
                file: base64File,
                fileName: imageFile.name || 'receipt.jpg'
            })
        });

        console.log('[OCR.Space] Proxy response status:', response.status, response.statusText);

        // Try to parse response as JSON
        let data;
        const responseText = await response.text();

        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            console.error('[OCR.Space] Failed to parse proxy response:', responseText.substring(0, 200));
            throw new Error('Server returned invalid response. Please try again or use a different image.');
        }

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Invalid API key. Please check your OCR.Space API key in Settings.');
            } else if (response.status === 429) {
                throw new Error('API rate limit exceeded. Please try again later.');
            } else {
                throw new Error(data.error || data.errorMessage || `API error (${response.status}): ${response.statusText}`);
            }
        }

        return data;
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

    parseOcrSpaceResponse(data) {
        const parsedText = data.ParsedResults?.[0]?.ParsedText || '';

        console.log('[OCR Parser] Raw text:', parsedText);

        // Split text into parts (by tabs and newlines)
        const parts = parsedText.split(/[\t\r\n]+/).map(p => p.trim()).filter(p => p);

        console.log('[OCR Parser] Split parts:', parts);

        // Extract data
        const receipt = {
            merchant: this.extractMerchant(parts),
            date: extractDateFromText(parsedText) || new Date().toISOString(),
            total: this.extractTotal(parts, parsedText),
            currency: DEFAULT_CURRENCY,
            category: 'Other',
            lineItems: this.extractLineItems(parts),
            notes: parsedText.substring(0, 500),
            rawData: { parsedText, parts }
        };

        // Suggest category based on merchant
        if (receipt.merchant && receipt.merchant !== 'Unknown Merchant') {
            receipt.category = this.suggestCategory(receipt.merchant);
        }

        // If no line items but have total, create one item
        if (receipt.lineItems.length === 0 && receipt.total > 0) {
            receipt.lineItems.push({
                name: 'Total',
                quantity: 1,
                price: receipt.total,
                category: receipt.category
            });
        }

        console.log('[OCR Parser] Final receipt:', receipt);
        return receipt;
    },

    extractMerchant(parts) {
        // Skip patterns that are NOT merchant names
        const skipPatterns = [
            /^\d+$/, // Just numbers
            /^\d{1,2}[\/\-\.]\d{1,2}/, // Dates
            /^total|subtotal|tax|iva|prezzo|descrizione/i,
            /^[X\+\*\-]\s/, // Item markers
            /^\d+[.,]\d{2}$/, // Prices
            /^\d+[.,]\d{2}%$/, // Percentages
            /^partita\s*iva/i, // VAT number label
            /^\d{11}$/, // VAT numbers
            /^documento/i,
            /^vendita|prestazione/i,
            /^prezzi\s*bassi/i, // Slogans
        ];

        for (const part of parts.slice(0, 10)) {
            const cleaned = cleanText(part);

            if (!cleaned || cleaned.length < 2 || cleaned.length > 60) continue;

            const shouldSkip = skipPatterns.some(p => p.test(cleaned));
            if (shouldSkip) continue;

            return cleaned;
        }

        return 'Unknown Merchant';
    },

    extractTotal(parts, fullText) {
        // Look for total patterns
        const totalKeywords = [
            /tot\.?\s*parziale/i,
            /totale/i,
            /grand\s*total/i,
            /total\s*due/i,
            /amount\s*due/i,
            /^total$/i,
            /balance/i,
        ];

        // Strategy 1: Find keyword followed by price
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];

            for (const keyword of totalKeywords) {
                if (keyword.test(part)) {
                    // Look for price in next parts
                    for (let j = i + 1; j < Math.min(i + 3, parts.length); j++) {
                        const priceMatch = parts[j].match(/^(\d+[.,]\d{2})$/);
                        if (priceMatch) {
                            const total = parseLocalNumber(priceMatch[1]);
                            if (total > 0) {
                                console.log('[OCR Parser] Found total:', total, 'from keyword:', part);
                                return total;
                            }
                        }
                    }

                    // Price might be embedded in the same part
                    const embeddedPrice = part.match(/(\d+[.,]\d{2})/);
                    if (embeddedPrice) {
                        const total = parseLocalNumber(embeddedPrice[1]);
                        if (total > 0) {
                            console.log('[OCR Parser] Found embedded total:', total);
                            return total;
                        }
                    }
                }
            }
        }

        // Strategy 2: Find the largest price (usually the total)
        const allPrices = extractPricesFromText(fullText);
        if (allPrices.length > 0) {
            const maxPrice = Math.max(...allPrices.map(p => p.value));
            console.log('[OCR Parser] Using max price as total:', maxPrice);
            return maxPrice;
        }

        return 0;
    },

    extractLineItems(parts) {
        const lineItems = [];
        const seenItems = new Set();

        // Skip patterns for non-item parts
        const skipPatterns = [
            /^total|^tot\.|^subtotal/i,
            /^tax|^iva$/i,
            /^descrizione|^prezzo/i,
            /^partita|^documento/i,
            /^\d{5,}$/, // Long numbers (phone, VAT, etc.)
            /via\s+|strada\s+/i, // Addresses
            /roma|milano|napoli/i, // Cities (adjust as needed)
        ];

        // Item markers that indicate the start of a line item
        const itemMarkers = /^[X\+\*\-]/i;

        console.log('[OCR Parser] Looking for line items in', parts.length, 'parts');

        // Strategy: Look for pattern [MARKER + NAME] [VAT%] [PRICE]
        for (let i = 0; i < parts.length - 1; i++) {
            const current = parts[i];

            // Check if current looks like an item (starts with marker or is followed by price)
            const hasMarker = itemMarkers.test(current);

            // Look ahead for VAT% and price pattern
            let vatIndex = -1;
            let priceIndex = -1;

            for (let j = i + 1; j < Math.min(i + 4, parts.length); j++) {
                if (parts[j].match(/^\d+[.,]\d{2}%$/)) {
                    vatIndex = j;
                } else if (parts[j].match(/^\d+[.,]\d{2}$/) && !parts[j].match(/%/)) {
                    priceIndex = j;
                    break; // Found price, stop looking
                }
            }

            // If we found a price and current part looks like an item name
            if (priceIndex > i) {
                const name = cleanText(current);
                const price = parseLocalNumber(parts[priceIndex]);

                // Validate
                if (name && name.length >= 2 && price > 0 && price < 1000) {
                    const shouldSkip = skipPatterns.some(p => p.test(name));

                    if (!shouldSkip && !seenItems.has(name.toLowerCase())) {
                        seenItems.add(name.toLowerCase());
                        lineItems.push({
                            name: name,
                            quantity: 1,
                            price: price,
                            category: this.suggestCategory(name)
                        });
                        console.log('[OCR Parser] Found item:', name, '=', price);

                        // Skip past this item's parts
                        i = priceIndex;
                    }
                }
            }
        }

        // Strategy 2: If no items found, try simpler pattern matching
        if (lineItems.length === 0) {
            console.log('[OCR Parser] No items with strategy 1, trying strategy 2');

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];

                // Check if this part is a price
                const priceMatch = part.match(/^(\d+[.,]\d{2})$/);
                if (priceMatch && i > 0) {
                    // Look back for item name
                    let nameIndex = i - 1;

                    // Skip VAT percentage if present
                    if (parts[nameIndex].match(/^\d+[.,]\d{2}%$/)) {
                        nameIndex--;
                    }

                    if (nameIndex >= 0) {
                        const name = cleanText(parts[nameIndex]);
                        const price = parseLocalNumber(priceMatch[1]);

                        if (name && name.length >= 2 && price > 0 && price < 1000) {
                            const shouldSkip = skipPatterns.some(p => p.test(name));

                            if (!shouldSkip && !seenItems.has(name.toLowerCase())) {
                                seenItems.add(name.toLowerCase());
                                lineItems.push({
                                    name: name,
                                    quantity: 1,
                                    price: price,
                                    category: this.suggestCategory(name)
                                });
                                console.log('[OCR Parser] Found item (strategy 2):', name, '=', price);
                            }
                        }
                    }
                }
            }
        }

        console.log('[OCR Parser] Total line items found:', lineItems.length);
        return lineItems;
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
