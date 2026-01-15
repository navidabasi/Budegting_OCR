import { format, parseISO, isValid } from 'date-fns';

export const formatCurrency = (amount, currency = 'EUR') => {
    // Auto-detect locale based on currency
    const localeMap = {
        'EUR': 'de-DE',
        'USD': 'en-US',
        'GBP': 'en-GB',
        'JPY': 'ja-JP',
        'CNY': 'zh-CN',
        'INR': 'en-IN',
        'AUD': 'en-AU',
        'CAD': 'en-CA',
    };
    const locale = localeMap[currency] || 'en-US';
    
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency
    }).format(amount);
};

export const formatDate = (date) => {
    if (!date) return '';
    try {
        const dateObj = typeof date === 'string' ? parseISO(date) : date;
        if (!isValid(dateObj)) return '';
        return format(dateObj, 'MMM dd, yyyy');
    } catch {
        return '';
    }
};

export const formatDateTime = (date) => {
    if (!date) return '';
    try {
        const dateObj = typeof date === 'string' ? parseISO(date) : date;
        if (!isValid(dateObj)) return '';
        return format(dateObj, 'MMM dd, yyyy HH:mm');
    } catch {
        return '';
    }
};

export const parseDate = (dateString) => {
    if (!dateString) return null;
    try {
        const parsed = parseISO(dateString);
        return isValid(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

export const generateId = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

export const validateApiKey = (key) => {
    return key && key.trim().length > 0;
};

/**
 * Clean text by removing unwanted characters
 * - Removes leading/trailing parentheses, brackets
 * - Removes leading/trailing whitespace
 * - Removes leading special markers (X, +, *, -)
 * - Normalizes multiple spaces
 */
export const cleanText = (text) => {
    if (!text || typeof text !== 'string') return '';
    
    let cleaned = text.trim();
    
    // Remove leading/trailing parentheses and brackets
    cleaned = cleaned.replace(/^[\(\[\{]+/, '').replace(/[\)\]\}]+$/, '');
    
    // Remove leading item markers (X, +, *, -)
    cleaned = cleaned.replace(/^[X\+\*\-]\s*/i, '');
    
    // Remove leading/trailing special characters
    cleaned = cleaned.replace(/^[^\w\s]+/, '').replace(/[^\w\s]+$/, '');
    
    // Normalize multiple spaces to single space
    cleaned = cleaned.replace(/\s+/g, ' ');
    
    return cleaned.trim();
};

/**
 * Parse a number that might use different decimal separators
 * Handles: 1.49 (US), 1,49 (EU), 1.234,56 (EU with thousands), 1,234.56 (US with thousands)
 */
export const parseLocalNumber = (str) => {
    if (!str) return 0;
    if (typeof str === 'number') return str;
    
    // Remove currency symbols, whitespace, and non-numeric chars except . and ,
    let cleaned = String(str).replace(/[€$£¥\s]/g, '').trim();
    
    // Handle European format: replace comma with dot for decimal
    if (cleaned.includes(',') && !cleaned.includes('.')) {
        // Only comma present: comma is decimal separator (European: 1,49)
        cleaned = cleaned.replace(',', '.');
    } else if (cleaned.includes(',') && cleaned.includes('.')) {
        // Both present: determine which is decimal separator
        const dotIndex = cleaned.lastIndexOf('.');
        const commaIndex = cleaned.lastIndexOf(',');
        
        if (commaIndex > dotIndex) {
            // Comma comes after dot: European format (1.234,56)
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else {
            // Dot comes after comma: US format (1,234.56)
            cleaned = cleaned.replace(/,/g, '');
        }
    }
    
    const result = parseFloat(cleaned);
    return isNaN(result) ? 0 : result;
};

/**
 * Extract date from text - supports multiple international formats
 * Returns ISO date string or null
 */
export const extractDateFromText = (text) => {
    if (!text) return null;
    
    // Common date patterns for different regions
    const patterns = [
        // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (European)
        { regex: /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/, parse: (m) => new Date(m[3], m[2] - 1, m[1]) },
        // YYYY/MM/DD or YYYY-MM-DD (ISO)
        { regex: /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/, parse: (m) => new Date(m[1], m[2] - 1, m[3]) },
        // MM/DD/YYYY (US)
        { regex: /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/, parse: (m) => new Date(m[3], m[1] - 1, m[2]) },
        // DD/MM/YY or DD-MM-YY (European short)
        { regex: /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})(?!\d)/, parse: (m) => {
            const year = parseInt(m[3]) + (parseInt(m[3]) > 50 ? 1900 : 2000);
            return new Date(year, m[2] - 1, m[1]);
        }},
        // Written dates: "15 Jan 2024", "Jan 15, 2024", "15 January 2024"
        { regex: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i, 
          parse: (m) => new Date(`${m[2]} ${m[1]}, ${m[3]}`) },
        { regex: /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i, 
          parse: (m) => new Date(`${m[1]} ${m[2]}, ${m[3]}`) },
    ];
    
    for (const { regex, parse } of patterns) {
        const match = text.match(regex);
        if (match) {
            try {
                const date = parse(match);
                // Validate date is reasonable (between 2000 and 2100)
                if (date && !isNaN(date.getTime()) && 
                    date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
                    return date.toISOString();
                }
            } catch (e) {
                // Continue to next pattern
            }
        }
    }
    
    return null;
};

/**
 * Extract all prices from text
 * Returns array of { value: number, original: string }
 */
export const extractPricesFromText = (text) => {
    if (!text) return [];
    
    const prices = [];
    
    // Pattern matches: €1,49 | $1.49 | 1,49 | 1.49 | €1.234,56
    const pricePatterns = [
        /[€$£¥]\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/g,  // Currency symbol + number
        /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*[€$£¥]/g,  // Number + currency symbol
        /(?<![.,\d])(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})(?![.,\d])/g,  // Plain number with decimals
    ];
    
    for (const pattern of pricePatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const value = parseLocalNumber(match[1] || match[0]);
            if (value > 0 && value < 100000) {
                prices.push({
                    value,
                    original: match[0]
                });
            }
        }
    }
    
    return prices;
};

