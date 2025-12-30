import { format, parseISO, isValid } from 'date-fns';

export const formatCurrency = (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
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

