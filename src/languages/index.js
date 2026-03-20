import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fa } from './fa';
import { fr } from './fr';
import { it } from './it';
import { ar } from './ar';

export const DEFAULT_LANGUAGE_CODE = 'en';

export const SUPPORTED_LANGUAGE_CODES = ['fa', 'ar', 'en', 'it', 'de', 'fr', 'es'];

export const LANGUAGE_OPTIONS = [
    { code: 'fa', label: 'Persian', nativeLabel: 'فارسی' },
    { code: 'ar', label: 'Arabic', nativeLabel: 'العربية' },
    { code: 'en', label: 'English', nativeLabel: 'English' },
    { code: 'it', label: 'Italian', nativeLabel: 'Italiano' },
    { code: 'de', label: 'German', nativeLabel: 'Deutsch' },
    { code: 'fr', label: 'French', nativeLabel: 'Français' },
    { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
];

export const TRANSLATIONS = {
    en,
    fa,
    ar,
    it,
    de,
    fr,
    es,
};

export function normalizeLanguageCode(rawCode, fallback = DEFAULT_LANGUAGE_CODE) {
    if (!rawCode || typeof rawCode !== 'string') {
        return fallback;
    }

    const normalized = rawCode.toLowerCase().trim().split('-')[0];
    return SUPPORTED_LANGUAGE_CODES.includes(normalized) ? normalized : fallback;
}

export function detectDeviceLanguage() {
    if (typeof navigator === 'undefined') {
        return DEFAULT_LANGUAGE_CODE;
    }

    const primary = navigator.language || navigator.languages?.[0] || DEFAULT_LANGUAGE_CODE;
    return normalizeLanguageCode(primary);
}

export function isRtlLanguage(languageCode) {
    const normalized = normalizeLanguageCode(languageCode);
    return normalized === 'fa' || normalized === 'ar';
}

export function getLanguageDirection(languageCode) {
    return isRtlLanguage(languageCode) ? 'rtl' : 'ltr';
}

function getByPath(source, path) {
    if (!source || !path) return undefined;
    return path.split('.').reduce((cursor, key) => (cursor && cursor[key] !== undefined ? cursor[key] : undefined), source);
}

function interpolate(template, params) {
    if (typeof template !== 'string') {
        return template;
    }

    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, token) => {
        if (!params || params[token] === undefined || params[token] === null) {
            return '';
        }
        return String(params[token]);
    });
}

export function tForLanguage(languageCode, key, params) {
    if (!key) return '';

    const normalized = normalizeLanguageCode(languageCode);
    const languagePack = TRANSLATIONS[normalized] || TRANSLATIONS[DEFAULT_LANGUAGE_CODE];
    const fallbackPack = TRANSLATIONS[DEFAULT_LANGUAGE_CODE];

    const value = getByPath(languagePack, key);
    if (typeof value === 'string') {
        return interpolate(value, params);
    }

    const fallbackValue = getByPath(fallbackPack, key);
    if (typeof fallbackValue === 'string') {
        return interpolate(fallbackValue, params);
    }

    return key;
}

export function translateCategoryName(categoryName, languageCode) {
    if (!categoryName) return '';

    const translated = tForLanguage(languageCode, `categories.${categoryName}`);
    if (translated === `categories.${categoryName}`) {
        return categoryName;
    }
    return translated;
}
