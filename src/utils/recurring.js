import { addDays, addMonths, addYears, format, isValid, parseISO } from 'date-fns';

function toDate(value) {
    if (value instanceof Date) {
        return value;
    }

    if (typeof value === 'string' && value) {
        const parsed = parseISO(value);
        if (isValid(parsed)) {
            return parsed;
        }
    }

    const fallback = new Date(value);
    return isValid(fallback) ? fallback : new Date();
}

export function calculateNextRecurringDate(fromDate, frequency = 'monthly') {
    const baseDate = toDate(fromDate);

    switch (frequency) {
        case 'weekly':
            return format(addDays(baseDate, 7), 'yyyy-MM-dd');
        case 'biweekly':
            return format(addDays(baseDate, 14), 'yyyy-MM-dd');
        case 'quarterly':
            return format(addMonths(baseDate, 3), 'yyyy-MM-dd');
        case 'yearly':
            return format(addYears(baseDate, 1), 'yyyy-MM-dd');
        case 'monthly':
        default:
            return format(addMonths(baseDate, 1), 'yyyy-MM-dd');
    }
}
