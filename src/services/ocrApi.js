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

    // Parse a number that might use European format (comma as decimal)
    parseNumber(str) {
        if (!str) return 0;
        // Remove currency symbols and whitespace
        let cleaned = str.replace(/[€$£¥\s]/g, '').trim();
        // Handle European format: replace comma with dot for decimal
        // But first check if it's likely European format (has comma but no dot)
        if (cleaned.includes(',') && !cleaned.includes('.')) {
            cleaned = cleaned.replace(',', '.');
        } else if (cleaned.includes(',') && cleaned.includes('.')) {
            // Has both - likely thousands separator is one of them
            // If comma is after dot, comma is decimal (unlikely)
            // If dot is after comma, dot is decimal (e.g., 1.234,56 -> 1234.56)
            const dotIndex = cleaned.lastIndexOf('.');
            const commaIndex = cleaned.lastIndexOf(',');
            if (commaIndex > dotIndex) {
                // European: 1.234,56 -> 1234.56
                cleaned = cleaned.replace(/\./g, '').replace(',', '.');
            } else {
                // US: 1,234.56 -> 1234.56
                cleaned = cleaned.replace(/,/g, '');
            }
        }
        return parseFloat(cleaned) || 0;
    },

    // Split OCR text into lines - handles both \n and \t separators
    splitIntoLines(text) {
        // First, split by newlines
        let lines = text.split(/\r?\n/);

        // If we got very few lines but have tabs, the receipt might be tab-separated
        if (lines.length <= 3 && text.includes('\t')) {
            // Split by tabs and try to reconstruct logical lines
            lines = this.reconstructLinesFromTabs(text);
        }

        return lines.filter(line => line.trim());
    },

    // Reconstruct lines from tab-separated OCR output
    reconstructLinesFromTabs(text) {
        const parts = text.split('\t');
        const lines = [];
        let currentLine = [];

        // Known patterns that indicate end of a logical line
        const lineEndPatterns = [
            /^\d+[.,]\d{2}$/, // Price like 1.49 or 1,49
            /^\d+[.,]\d{2}%$/, // Percentage like 22,00%
            /\d{5}/, // Zip code
            /^\d{2}[\/\-\.]\d{2}[\/\-\.]\d{2,4}$/, // Date
        ];

        // Patterns that indicate start of a new logical section
        const lineStartPatterns = [
            /^[X\+\*\-]\s/, // Item markers like "X ", "+ ", "* "
            /^DESCRIZIONE/i,
            /^TOTAL/i,
            /^TOT\./i,
            /^SUBTOTAL/i,
            /^IVA/i,
        ];

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();
            if (!part) continue;

            // Check if this part starts a new line
            const startsNewLine = lineStartPatterns.some(p => p.test(part));

            // Check if previous part ended a line (was a price)
            const prevEndedLine = currentLine.length > 0 &&
                lineEndPatterns.some(p => p.test(currentLine[currentLine.length - 1]));

            if ((startsNewLine || prevEndedLine) && currentLine.length > 0) {
                lines.push(currentLine.join('\t'));
                currentLine = [];
            }

            currentLine.push(part);
        }

        // Don't forget the last line
        if (currentLine.length > 0) {
            lines.push(currentLine.join('\t'));
        }

        return lines;
    },

    parseOcrSpaceResponse(data) {
        // OCR.Space returns plain text, so we need to parse it
        const parsedText = data.ParsedResults?.[0]?.ParsedText || '';
        const lines = this.splitIntoLines(parsedText);

        console.log('[OCR Parser] Split into lines:', lines);

        // Try to extract receipt information from text
        const receipt = {
            merchant: this.extractMerchant(lines, parsedText),
            date: this.extractDate(lines, parsedText) || new Date().toISOString(),
            total: this.extractTotal(lines, parsedText),
            category: 'Other',
            lineItems: this.extractLineItems(lines, parsedText),
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

        console.log('[OCR Parser] Extracted receipt:', receipt);
        return receipt;
    },

    extractMerchant(lines, fullText) {
        // Try from structured lines first
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            const line = lines[i].trim();
            // Get first tab-separated part if present
            const firstPart = line.split('\t')[0].trim();

            // Skip common non-merchant patterns
            if (firstPart &&
                !firstPart.match(/^\d+$/) && // Not just numbers
                !firstPart.match(/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/) && // Not a date
                !firstPart.match(/^total|subtotal|tax|amount|receipt|invoice|descrizione|iva|prezzo/i) && // Not a label
                !firstPart.match(/^#\d+/) && // Not an order number
                !firstPart.match(/^[X\+\*\-]\s/) && // Not an item marker
                firstPart.length > 2 && firstPart.length < 50) {
                return firstPart;
            }
        }

        // Fallback: try to find first reasonable text from full text
        const tabParts = fullText.split('\t');
        for (const part of tabParts.slice(0, 5)) {
            const cleaned = part.trim();
            if (cleaned &&
                cleaned.length > 2 && cleaned.length < 50 &&
                !cleaned.match(/^\d+$/) &&
                !cleaned.match(/prezzi|sempre|descrizione|iva/i)) {
                return cleaned;
            }
        }

        return 'Unknown Merchant';
    },

    extractDate(lines, fullText) {
        // Look for date patterns in both lines and full text
        const datePatterns = [
            /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,
            /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/,
            /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})/
        ];

        const searchText = lines.join(' ') + ' ' + fullText;

        for (const pattern of datePatterns) {
            const match = searchText.match(pattern);
            if (match) {
                try {
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
        return null;
    },

    extractTotal(lines, fullText) {
        // Look for total patterns - handle both formats
        const totalPatterns = [
            // Italian patterns
            /TOT\.?\s*PARZIALE[.\s]*(\d+[.,]\d{2})/i,
            /TOTALE[:\s]*€?\s*(\d+[.,]\d{2})/i,
            // English patterns
            /(?:grand\s+)?total[:\s]*[$€]?\s*(\d+[.,]\d{2})/i,
            /amount\s+due[:\s]*[$€]?\s*(\d+[.,]\d{2})/i,
            /total\s+due[:\s]*[$€]?\s*(\d+[.,]\d{2})/i,
            /balance[:\s]*[$€]?\s*(\d+[.,]\d{2})/i,
        ];

        const searchText = lines.join('\t') + '\t' + fullText;

        for (const pattern of totalPatterns) {
            const match = searchText.match(pattern);
            if (match) {
                const amount = this.parseNumber(match[1]);
                if (amount > 0 && amount < 100000) {
                    return amount;
                }
            }
        }

        // Fallback: find the largest price that looks like a total
        let maxAmount = 0;
        const pricePattern = /(\d+[.,]\d{2})/g;
        let match;
        while ((match = pricePattern.exec(searchText)) !== null) {
            const amount = this.parseNumber(match[1]);
            if (amount > maxAmount && amount < 10000) {
                maxAmount = amount;
            }
        }

        return maxAmount;
    },

    extractLineItems(lines, fullText) {
        const lineItems = [];

        // Pattern 1: Tab-separated with price at end
        // e.g., "X CANDELA YANKEE C-TAP\t22,00%\t1,49"
        for (const line of lines) {
            const parts = line.split('\t').map(p => p.trim()).filter(p => p);

            if (parts.length >= 2) {
                // Check if last part looks like a price
                const lastPart = parts[parts.length - 1];
                const priceMatch = lastPart.match(/^(\d+[.,]\d{2})$/);

                if (priceMatch) {
                    // Get the item name (might be first part, possibly with marker removed)
                    let name = parts[0];

                    // Remove common item markers at start
                    name = name.replace(/^[X\+\*\-]\s*/, '').trim();

                    // Skip if it looks like a total or header
                    if (name.toLowerCase().match(/^(tot|total|subtotal|sub-total|tax|tip|discount|change|cash|credit|debit|card|descrizione|iva|prezzo|parziale)/i)) {
                        continue;
                    }

                    // Skip very short names
                    if (name.length < 2) continue;

                    const price = this.parseNumber(priceMatch[1]);
                    if (price > 0 && price < 1000) {
                        lineItems.push({
                            name: name,
                            quantity: 1,
                            price: price,
                            category: this.suggestCategory(name)
                        });
                    }
                }
            }
        }

        // Pattern 2: Inline price pattern "Item Name 1.49" or "Item Name €1,49"
        if (lineItems.length === 0) {
            const itemPattern = /^(.+?)\s+[$€]?\s*(\d+[.,]\d{2})\s*$/;

            for (const line of lines) {
                const match = line.match(itemPattern);
                if (match) {
                    let name = match[1].trim();
                    name = name.replace(/^[X\+\*\-]\s*/, '').trim();

                    if (name.toLowerCase().match(/^(total|subtotal|tax|tip|discount|change|cash|credit|debit|card|balance|savings|parziale)/i)) {
                        continue;
                    }

                    if (name.length < 2 || name.match(/^\d+$/) || name.match(/^#/)) {
                        continue;
                    }

                    const price = this.parseNumber(match[2]);
                    if (price > 0 && price < 1000) {
                        lineItems.push({
                            name: name,
                            quantity: 1,
                            price: price,
                            category: this.suggestCategory(name)
                        });
                    }
                }
            }
        }

        // Pattern 3: Search full text for price patterns with preceding text
        if (lineItems.length === 0 && fullText) {
            // Split by tabs and look for name + price pairs
            const tabParts = fullText.split('\t');

            for (let i = 0; i < tabParts.length - 1; i++) {
                const current = tabParts[i].trim();
                const next = tabParts[i + 1].trim();

                // Check if next looks like a price
                if (next.match(/^\d+[.,]\d{2}$/)) {
                    // Current might be VAT percentage, check the one before
                    if (current.match(/^\d+[.,]\d{2}%$/) && i > 0) {
                        const name = tabParts[i - 1].trim().replace(/^[X\+\*\-]\s*/, '');
                        if (name.length > 2 && !name.toLowerCase().match(/descrizione|iva|prezzo|total|parziale/i)) {
                            const price = this.parseNumber(next);
                            if (price > 0 && price < 1000) {
                                lineItems.push({
                                    name: name,
                                    quantity: 1,
                                    price: price,
                                    category: this.suggestCategory(name)
                                });
                            }
                        }
                    } else if (!current.match(/^\d+[.,]\d{2}%?$/) && current.length > 2) {
                        // Current is the item name
                        const name = current.replace(/^[X\+\*\-]\s*/, '');
                        if (!name.toLowerCase().match(/descrizione|iva|prezzo|total|parziale|subtotal/i)) {
                            const price = this.parseNumber(next);
                            if (price > 0 && price < 1000) {
                                lineItems.push({
                                    name: name,
                                    quantity: 1,
                                    price: price,
                                    category: this.suggestCategory(name)
                                });
                            }
                        }
                    }
                }
            }
        }

        console.log('[OCR Parser] Extracted line items:', lineItems);
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
