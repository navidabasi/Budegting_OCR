/**
 * Locale-aware amount formatting for the UI (design: monospace, tabular, `1.240,30`).
 * The locale follows the app language; English + EUR uses German-style separators (1.240,30) as in the design.
 */
const LOCALES = {
    it: 'it-IT',
    de: 'de-DE',
    es: 'es-ES',
    fr: 'fr-FR',
    fa: 'fa-IR-u-nu-latn',
    ar: 'ar-EG-u-nu-latn',
};

export function localeFor(languageCode = 'en', currency = 'EUR') {
    if (LOCALES[languageCode]) return LOCALES[languageCode];
    return currency === 'EUR' ? 'de-DE' : 'en-US'; // EUR users get comma decimals (matches formatCurrency)
}

const cache = new Map();
function numberFormat(locale, minDigits, maxDigits) {
    const key = `${locale}|${minDigits}|${maxDigits}`;
    if (!cache.has(key)) {
        cache.set(key, new Intl.NumberFormat(locale, { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits, useGrouping: true }));
    }
    return cache.get(key);
}

/** 1240.3 -> "1.240,30" (it/de/es...). Always two decimals unless `digits` says otherwise. */
export function formatAmount(value, { locale = 'de-DE', digits = 2 } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return numberFormat(locale, digits, digits).format(n);
}

/** Symbol for a currency code in a locale ("EUR" -> "€"). */
export function currencySymbol(currency = 'EUR', locale = 'de-DE') {
    try {
        const parts = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
        return parts.find((p) => p.type === 'currency')?.value || currency;
    } catch {
        return currency;
    }
}

/** "23,47 €" - amount + narrow symbol, the shape used in button labels and toasts. */
export function formatMoney(value, currency = 'EUR', locale = 'de-DE') {
    const text = formatAmount(value, { locale });
    return text ? `${text} ${currencySymbol(currency, locale)}` : '';
}

export function decimalSeparator(locale = 'de-DE') {
    const part = new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal');
    return part?.value || '.';
}
