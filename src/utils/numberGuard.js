// "Every number the model states must exist in its input" (pass 3, A4). Pure and dependency-free: used on the device
// (evidencePack.js, the Insights cards) and by the server (api/insights.js), so keep it free of imports.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const FIGURE = /(?<![\w.])(\d{1,3}(?:[.,\s  ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\w])/g;
const toNumber = (raw) => Number(raw.replace(/[\s  ]/g, '').replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
// Persian and Arabic digits are read as the same numbers
const latinDigits = (s) => String(s ?? '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.').replace(/٬/g, ',');

/**
 * Every number in a JSON-like value, as a Set of absolute values (rounded to 2 decimals, and to whole units, because an amount
 * is often written without cents). With `strings`, numbers written inside strings (dates, prepared sentences) count too.
 */
export function collectNumbers(value, { strings = true } = {}) {
    const out = new Set();
    const add = (v) => {
        if (!Number.isFinite(v)) return;
        out.add(Math.abs(round2(v)));
        out.add(Math.abs(Math.round(v)));
    };
    const walk = (v) => {
        if (typeof v === 'number') add(v);
        else if (typeof v === 'string') {
            if (strings) for (const m of latinDigits(v).matchAll(/\d+(?:[.,]\d+)?/g)) add(Number(m[0].replace(',', '.')));
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(value);
    return out;
}

/**
 * Figures in a text that are not among the known numbers. A figure with decimals is always checked; a whole number is checked
 * from `minInteger` up (small counts such as "3 months" are left alone below it). Years are never treated as amounts.
 * -> the offending figures as written.
 */
export function figuresNotIn(text, known, { minInteger = 100 } = {}) {
    const values = [...known];
    const out = [];
    for (const m of latinDigits(text).matchAll(FIGURE)) {
        const raw = m[1];
        const hasDecimals = /[.,]\d{1,2}$/.test(raw);
        const n = toNumber(raw);
        if (!Number.isFinite(n) || (!hasDecimals && n < minInteger)) continue;
        if (n >= 1900 && n <= 2100 && !hasDecimals) continue; // years
        if (!values.some((k) => Math.abs(k - Math.abs(n)) < 0.011)) out.push(raw);
    }
    return [...new Set(out)];
}
