import { MERCHANT_CATEGORY_MAP, DEFAULT_CATEGORY } from '../utils/constants';

export const ocrApi = {
    async processReceipt(imageFile, apiKey = null) {
        try {
            console.log('[OCR.Space] Processing receipt...', {
                fileSize: imageFile.size,
                fileName: imageFile.name
            });

            // Convert file to base64 for sending to proxy
            const base64File = await this.fileToBase64(imageFile);

            // Use proxy endpoint to avoid CORS issues
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

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));

                if (response.status === 401) {
                    throw new Error('Invalid API key. Please check your OCR.Space API key in Settings.');
                } else if (response.status === 429) {
                    throw new Error('API rate limit exceeded. Please try again later.');
                } else {
                    throw new Error(errorData.error || errorData.errorMessage || `API error (${response.status}): ${response.statusText}`);
                }
            }

            const data = await response.json();
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
        // OCR.Space returns plain text, so we need to parse it
        const parsedText = data.ParsedResults?.[0]?.ParsedText || '';
        const lines = parsedText.split('\n').filter(line => line.trim());

        // Try to extract receipt information from text
        const receipt = {
            merchant: this.extractMerchant(lines),
            date: this.extractDate(lines) || new Date().toISOString(),
            total: this.extractTotal(lines),
            category: 'Other',
            lineItems: this.extractLineItems(lines),
            notes: parsedText.substring(0, 500), // Store first 500 chars as notes
            rawData: { parsedText, lines }
        };

        // Suggest category based on merchant
        if (receipt.merchant) {
            receipt.category = this.suggestCategory(receipt.merchant);
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

    extractMerchant(lines) {
        // Usually merchant name is in first few lines
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            const line = lines[i].trim();
            // Skip common non-merchant patterns
            if (line &&
                !line.match(/^\d+$/) && // Not just numbers
                !line.match(/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/) && // Not a date
                !line.match(/^total|subtotal|tax|amount|receipt|invoice/i) && // Not a label
                !line.match(/^#\d+/) && // Not an order number
                line.length > 2 && line.length < 50) {
                return line;
            }
        }
        return 'Unknown Merchant';
    },

    extractDate(lines) {
        // Look for date patterns: MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, etc.
        const datePatterns = [
            /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,
            /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/,
            /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})/
        ];

        for (const line of lines) {
            for (const pattern of datePatterns) {
                const match = line.match(pattern);
                if (match) {
                    try {
                        // Try to parse the date
                        let dateStr = match[0];
                        const date = new Date(dateStr);
                        if (!isNaN(date.getTime()) && date.getFullYear() > 2000 && date.getFullYear() < 2100) {
                            return date.toISOString();
                        }
                    } catch (e) {
                        // Continue searching
                    }
                }
            }
        }
        return null;
    },

    extractTotal(lines) {
        // Look for "TOTAL", "AMOUNT", "TOTAL DUE" followed by a number
        const totalPatterns = [
            /(?:grand\s+)?total[:\s]*\$?\s*(\d+\.?\d*)/i,
            /amount\s+due[:\s]*\$?\s*(\d+\.?\d*)/i,
            /total\s+due[:\s]*\$?\s*(\d+\.?\d*)/i,
            /balance[:\s]*\$?\s*(\d+\.?\d*)/i,
            /\btotal\b[:\s]*\$?\s*(\d+\.?\d*)/i
        ];

        // Search from bottom up (totals are usually at the end)
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].toLowerCase();

            // Skip lines that are subtotals or tax
            if (line.match(/subtotal|sub-total|tax|tip|discount|savings/i)) {
                continue;
            }

            for (const pattern of totalPatterns) {
                const match = lines[i].match(pattern);
                if (match) {
                    const amount = parseFloat(match[1]);
                    if (!isNaN(amount) && amount > 0 && amount < 100000) {
                        return amount;
                    }
                }
            }
        }

        // Fallback: look for largest reasonable amount
        let maxAmount = 0;
        for (const line of lines) {
            // Match currency amounts like $12.34 or 12.34
            const amounts = line.match(/\$?\s*(\d+\.\d{2})\b/g);
            if (amounts) {
                amounts.forEach(amt => {
                    const num = parseFloat(amt.replace(/[^\d.]/g, ''));
                    if (!isNaN(num) && num > maxAmount && num < 10000) {
                        maxAmount = num;
                    }
                });
            }
        }
        return maxAmount > 0 ? maxAmount : 0;
    },

    extractLineItems(lines) {
        const lineItems = [];
        // Look for patterns like: "Item Name $X.XX" or "Item Name    X.XX"
        const itemPattern = /^(.+?)\s+\$?\s*(\d+\.\d{2})\s*$/;

        for (const line of lines) {
            const match = line.match(itemPattern);
            if (match) {
                const name = match[1].trim();
                const price = parseFloat(match[2]);

                // Skip if it looks like a total, tax, or meta line
                if (name.toLowerCase().match(/^(total|subtotal|sub-total|tax|tip|discount|change|cash|credit|debit|card|visa|master|amex|balance|savings)/i)) {
                    continue;
                }

                // Skip very short names or obvious non-items
                if (name.length < 2 || name.match(/^\d+$/) || name.match(/^#/)) {
                    continue;
                }

                if (!isNaN(price) && price > 0 && price < 1000) {
                    lineItems.push({
                        name: name,
                        quantity: 1,
                        price: price,
                        category: this.suggestCategory(name)
                    });
                }
            }
        }

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

