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

/**
 * Parse app date values safely.
 * Important: date-only strings (YYYY-MM-DD) are parsed as local dates to avoid UTC month/day drift.
 */
export const parseAppDate = (value) => {
    if (!value) return null;

    if (value instanceof Date) {
        return isValid(value) ? value : null;
    }

    if (typeof value === 'string') {
        const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateOnlyMatch) {
            const year = parseInt(dateOnlyMatch[1], 10);
            const month = parseInt(dateOnlyMatch[2], 10);
            const day = parseInt(dateOnlyMatch[3], 10);
            const localDate = new Date(year, month - 1, day);
            return Number.isNaN(localDate.getTime()) ? null : localDate;
        }

        try {
            const parsedIso = parseISO(value);
            if (isValid(parsedIso)) {
                return parsedIso;
            }
        } catch {
            // Fall through to native Date parsing.
        }
    }

    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
};

/**
 * Build YYYY-MM key from a date value.
 */
export const getMonthKey = (value) => {
    const date = parseAppDate(value);
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Check if a date value belongs to a given month index/year.
 * @param {string|Date} value
 * @param {number} monthIndex - 0-11
 * @param {number} year
 */
export const isDateInMonthYear = (value, monthIndex, year) => {
    const date = parseAppDate(value);
    if (!date) return false;
    return date.getMonth() === monthIndex && date.getFullYear() === year;
};

/**
 * Build local YYYY-MM-DD key from a date value.
 */
export const getDateKey = (value) => {
    const date = parseAppDate(value);
    if (!date) return '';
    return format(date, 'yyyy-MM-dd');
};

/**
 * Compare two date values descending (newest first).
 */
export const compareDateValuesDesc = (dateAValue, dateBValue) => {
    const dateA = parseAppDate(dateAValue);
    const dateB = parseAppDate(dateBValue);
    const timeA = dateA ? dateA.getTime() : 0;
    const timeB = dateB ? dateB.getTime() : 0;
    return timeB - timeA;
};

export const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export const getMonthName = (monthIndex) => {
    if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
        return '';
    }
    return MONTH_NAMES[monthIndex];
};

export const formatMonthYearLabel = (monthIndex, year) => {
    const monthName = getMonthName(monthIndex);
    if (!monthName || !year) return '';
    return `${monthName} ${year}`;
};

export const buildReturnToPath = (location) => {
    if (!location || !location.pathname) return '/receipts';
    return `${location.pathname}${location.search || ''}`;
};

export const resolveReceiptBackTarget = (receiptId, returnTo, fallback = '/receipts') => {
    if (!returnTo) return fallback;
    const receiptPath = `/receipts/${receiptId}`;
    return returnTo === receiptPath ? fallback : returnTo;
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

/**
 * Get the effective amount for a receipt - the user's share if split, or full amount if not
 * @param {Object} receipt - The receipt object
 * @returns {number} - The effective amount the user is responsible for
 */
export const getEffectiveAmount = (receipt) => {
    if (!receipt) return 0;

    const total = parseFloat(receipt.total) || 0;

    // If not split, return full amount
    if (!receipt.splitData) {
        return total;
    }

    // If split, return the user's share
    const { splitData } = receipt;

    // If yourShare is explicitly stored, use it
    if (splitData.yourShare !== undefined && splitData.yourShare !== null) {
        return parseFloat(splitData.yourShare) || 0;
    }

    // Calculate based on split method
    if (splitData.method === 'equal') {
        const people = splitData.people || 1;
        return total / people;
    }

    // For custom split, first user is "You"
    if (splitData.users && splitData.users.length > 0) {
        return parseFloat(splitData.users[0].amount) || 0;
    }

    // Fallback to equal split
    const people = splitData.people || 1;
    return total / people;
};
