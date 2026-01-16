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
        formData.append('isOverlayRequired', 'true');
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
        const textOverlay = data.ParsedResults?.[0]?.TextOverlay || null;

        console.log('[OCR Parser] Raw text:', parsedText);
        console.log('[OCR Parser] Has overlay:', !!textOverlay);

        let receipt;

        // Use overlay if available for better extraction
        if (textOverlay && textOverlay.Lines && textOverlay.Lines.length > 0) {
            console.log('[OCR Parser] Using overlay-based parsing');
            receipt = this.parseWithOverlay(parsedText, textOverlay);
        } else {
            console.log('[OCR Parser] Using text-based parsing (fallback)');
            // Fallback to text-based parsing
            const parts = parsedText.split(/[\t\r\n]+/).map(p => p.trim()).filter(p => p);
            receipt = this.parseWithoutOverlay(parts, parsedText);
        }

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

    // Fallback: Original text-based parsing
    parseWithoutOverlay(parts, parsedText) {
        return {
            merchant: this.extractMerchant(parts),
            date: extractDateFromText(parsedText) || new Date().toISOString(),
            total: this.extractTotal(parts, parsedText),
            currency: DEFAULT_CURRENCY,
            category: 'Other',
            lineItems: this.extractLineItems(parts),
            notes: parsedText.substring(0, 500),
            rawData: { parsedText, parts }
        };
    },

    // NEW: Parse using overlay bounding boxes
    parseWithOverlay(parsedText, textOverlay) {
        const lines = textOverlay.Lines;
        
        if (!lines || lines.length === 0) {
            console.log('[OCR Parser] No lines in overlay, falling back to text parsing');
            const parts = parsedText.split(/[\t\r\n]+/).map(p => p.trim()).filter(p => p);
            return this.parseWithoutOverlay(parts, parsedText);
        }

        // Calculate document dimensions
        const maxHeight = Math.max(...lines.map(l => (l.MinTop || 0) + (l.MaxHeight || 0)));
        const maxWidth = Math.max(...lines.flatMap(l => 
            (l.Words || []).map(w => (w.Left || 0) + (w.Width || 0))
        ));

        console.log('[OCR Parser] Document dimensions:', { maxHeight, maxWidth });

        // Divide receipt into sections by Y position
        const headerThreshold = maxHeight * 0.25;  // Top 25%
        const footerThreshold = maxHeight * 0.75;  // Bottom 25%

        const headerLines = [];
        const bodyLines = [];
        const footerLines = [];

        lines.forEach(line => {
            const yPos = line.MinTop || 0;
            if (yPos < headerThreshold) {
                headerLines.push(line);
            } else if (yPos > footerThreshold) {
                footerLines.push(line);
            } else {
                bodyLines.push(line);
            }
        });

        console.log('[OCR Parser] Section distribution:', {
            header: headerLines.length,
            body: bodyLines.length,
            footer: footerLines.length
        });

        // Extract data
        const merchant = this.extractMerchantFromOverlay(headerLines);
        const date = this.extractDateFromOverlay(headerLines, parsedText);
        const lineItems = this.extractLineItemsFromOverlay(bodyLines);
        const total = this.extractTotalFromOverlay(footerLines);

        return {
            merchant: merchant || 'Unknown Merchant',
            date: date || new Date().toISOString(),
            total: total || 0,
            currency: DEFAULT_CURRENCY,
            category: 'Other',
            lineItems: lineItems,
            notes: parsedText.substring(0, 500),
            rawData: { parsedText, overlay: textOverlay }
        };
    },

    // Extract merchant from header section
    extractMerchantFromOverlay(headerLines) {
        if (headerLines.length === 0) return null;

        // Merchant is usually the first line, largest text, or most prominent
        const firstLine = headerLines[0];
        if (firstLine && firstLine.Words && firstLine.Words.length > 0) {
            const merchantText = firstLine.Words
                .map(w => w.WordText || '')
                .join(' ')
                .trim();

            // Skip if it looks like an address or date
            if (merchantText && !merchantText.match(/^\d+|^\d{1,2}[\/\-\.]/)) {
                const cleaned = cleanText(merchantText);
                if (cleaned.length >= 2 && cleaned.length <= 60) {
                    console.log('[OCR Parser] Found merchant from overlay:', cleaned);
                    return cleaned;
                }
            }
        }

        // Try second line if first doesn't work
        if (headerLines.length > 1) {
            const secondLine = headerLines[1];
            if (secondLine && secondLine.Words && secondLine.Words.length > 0) {
                const merchantText = secondLine.Words
                    .map(w => w.WordText || '')
                    .join(' ')
                    .trim();
                const cleaned = cleanText(merchantText);
                if (cleaned.length >= 2 && cleaned.length <= 60) {
                    console.log('[OCR Parser] Found merchant from overlay (line 2):', cleaned);
                    return cleaned;
                }
            }
        }

        return null;
    },

    // Extract date from header (look for date patterns)
    extractDateFromOverlay(headerLines, fullText) {
        // Check header lines for date patterns
        for (const line of headerLines) {
            if (line.Words && line.Words.length > 0) {
                const lineText = line.Words.map(w => w.WordText || '').join(' ');
                const dateMatch = extractDateFromText(lineText);
                if (dateMatch) {
                    console.log('[OCR Parser] Found date from overlay:', dateMatch);
                    return dateMatch;
                }
            }
        }

        // Fallback to full text search
        const dateMatch = extractDateFromText(fullText);
        if (dateMatch) {
            console.log('[OCR Parser] Found date from full text:', dateMatch);
            return dateMatch;
        }

        return null;
    },

    // Group words into rows (same Y position ± threshold)
    groupWordsIntoRows(lines) {
        const rows = [];
        const yThreshold = 5; // Pixels

        lines.forEach(line => {
            if (!line.Words || line.Words.length === 0) return;

            const yPos = line.MinTop || 0;

            // Find existing row with similar Y position
            let foundRow = rows.find(row => 
                row.length > 0 && Math.abs((row[0].Top || 0) - yPos) < yThreshold
            );

            if (foundRow) {
                // Add words to existing row
                foundRow.push(...line.Words);
            } else {
                // Create new row
                rows.push([...line.Words]);
            }
        });

        // Sort words in each row by X position (left to right)
        rows.forEach(row => {
            row.sort((a, b) => (a.Left || 0) - (b.Left || 0));
        });

        return rows;
    },

    // Extract line items using column alignment
    extractLineItemsFromOverlay(bodyLines) {
        const lineItems = [];
        const seenItems = new Set();

        if (bodyLines.length === 0) {
            console.log('[OCR Parser] No body lines for line items');
            return lineItems;
        }

        // Group words into rows
        const rows = this.groupWordsIntoRows(bodyLines);
        console.log('[OCR Parser] Grouped into', rows.length, 'rows');

        // Skip patterns for non-item parts
        const skipPatterns = [
            /^total|^tot\.|^subtotal/i,
            /^tax|^iva$/i,
            /^descrizione|^prezzo/i,
            /^partita|^documento/i,
            /^\d{5,}$/, // Long numbers (phone, VAT, etc.)
            /via\s+|strada\s+/i, // Addresses
        ];

        rows.forEach(row => {
            // Find price (usually right-aligned, matches price pattern)
            const prices = row.filter(w => {
                const text = w.WordText || '';
                return text.match(/^\$?\d+[.,]\d{2}$/);
            });

            if (prices.length > 0) {
                // Item name is everything before the price
                const priceWord = prices[0];
                const itemWords = row.filter(w => {
                    const text = w.WordText || '';
                    return (w.Left || 0) < (priceWord.Left || 0) && 
                           !text.match(/^\d+[.,]\d{2}%?$/) && // Not a price or percentage
                           !text.match(/^\d+$/); // Not just numbers
                });

                if (itemWords.length > 0) {
                    const itemName = itemWords
                        .map(w => w.WordText || '')
                        .join(' ')
                        .trim();

                    const priceText = (priceWord.WordText || '').replace('$', '');
                    const price = parseLocalNumber(priceText);

                    if (itemName.length >= 2 && price > 0 && price < 10000) {
                        const cleanedName = cleanText(itemName);
                        const shouldSkip = skipPatterns.some(p => p.test(cleanedName));

                        if (!shouldSkip && !seenItems.has(cleanedName.toLowerCase())) {
                            seenItems.add(cleanedName.toLowerCase());
                            lineItems.push({
                                name: cleanedName,
                                quantity: 1,
                                price: price,
                                category: this.suggestCategory(cleanedName)
                            });
                            console.log('[OCR Parser] Found item from overlay:', cleanedName, '=', price);
                        }
                    }
                }
            }
        });

        console.log('[OCR Parser] Total line items from overlay:', lineItems.length);
        return lineItems;
    },

    // Extract total from footer (look for "Total" keyword)
    extractTotalFromOverlay(footerLines) {
        const totalKeywords = [
            /total|totale/i,
            /tot\.?\s*parziale/i,
            /grand\s*total/i,
            /total\s*due/i,
            /amount\s*due/i,
            /balance/i,
        ];

        for (const line of footerLines) {
            if (!line.Words || line.Words.length === 0) continue;

            const words = line.Words;
            const lineText = words.map(w => w.WordText || '').join(' ').toLowerCase();

            // Check if line contains "total" keyword
            const hasTotalKeyword = totalKeywords.some(keyword => keyword.test(lineText));

            if (hasTotalKeyword) {
                // Find price in this line
                const priceWord = words.find(w => {
                    const text = w.WordText || '';
                    return text.match(/^\$?\d+[.,]\d{2}$/);
                });

                if (priceWord) {
                    const priceText = (priceWord.WordText || '').replace('$', '');
                    const total = parseLocalNumber(priceText);
                    if (total > 0) {
                        console.log('[OCR Parser] Found total from overlay:', total);
                        return total;
                    }
                }
            }
        }

        // Also check body lines for total (sometimes it's not in footer)
        const allLines = footerLines;
        for (const line of allLines) {
            if (!line.Words || line.Words.length === 0) continue;

            const words = line.Words;
            // Look for any price in footer lines (might be the largest)
            const prices = words
                .filter(w => {
                    const text = w.WordText || '';
                    return text.match(/^\$?\d+[.,]\d{2}$/);
                })
                .map(w => {
                    const text = (w.WordText || '').replace('$', '');
                    return parseLocalNumber(text);
                })
                .filter(p => p > 0);

            if (prices.length > 0) {
                const maxPrice = Math.max(...prices);
                console.log('[OCR Parser] Using max price from footer as total:', maxPrice);
                return maxPrice;
            }
        }

        return 0;
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
