/**
 * Keypad input model for Quick Add. The expression is kept canonical (digits, '.' decimal, '+' joins
 * several amounts, e.g. "12.40+3.20"); `displayExpression` renders it with the locale's decimal separator.
 */
export const MAX_INT_DIGITS = 9;
export const MAX_DECIMALS = 2;

const lastSegment = (expr) => expr.slice(expr.lastIndexOf('+') + 1);

export function pressKey(expr, key) {
    let e = expr || '';
    if (key === 'back') return e.slice(0, -1);
    if (key === 'clear') return '';
    if (key === '+') {
        if (!e || e.endsWith('+')) return e;
        if (e.endsWith('.')) e = e.slice(0, -1);
        return `${e}+`;
    }
    if (key === ',' || key === '.') {
        const last = lastSegment(e);
        if (last.includes('.')) return e;
        return last === '' ? `${e}0.` : `${e}.`;
    }
    if (key === '00') {
        const last = lastSegment(e);
        if (last === '0') return e;
        if (last === '') return `${e}0`;
        return pressKey(pressKey(e, '0'), '0');
    }
    if (/^[0-9]$/.test(key)) {
        const last = lastSegment(e);
        if (last === '0') return key === '0' ? e : `${e.slice(0, -1)}${key}`;
        const [int, frac] = last.split('.');
        if (frac !== undefined) {
            if (frac.length >= MAX_DECIMALS) return e;
        } else if (int.length >= MAX_INT_DIGITS) return e;
        return `${e}${key}`;
    }
    return e;
}

/** Sum of all "+" separated parts, rounded to cents. */
export function evaluate(expr) {
    if (!expr) return 0;
    const sum = expr.split('+').reduce((acc, part) => acc + (parseFloat(part) || 0), 0);
    return Math.round(sum * 100) / 100;
}

export function displayExpression(expr, separator = ',') {
    if (!expr) return `0`;
    return expr.replace(/\./g, separator).replace(/\+/g, '+');
}

/** Map a physical keyboard key to a keypad key (or null). */
export function keyFromEvent(key) {
    if (/^[0-9]$/.test(key)) return key;
    if (key === ',' || key === '.') return ',';
    if (key === '+') return '+';
    if (key === 'Backspace') return 'back';
    return null;
}

/** Start the expression from a stored amount (edit/prefill). */
export function expressionFromNumber(n) {
    if (!n || !Number.isFinite(Number(n))) return '';
    const v = Math.round(Number(n) * 100) / 100;
    return String(v);
}
