import { en } from './en';

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

// English is bundled (it is also the fallback for every other pack); the other six load on demand so they stay out of the main chunk.
export const TRANSLATIONS = { en };

const LOADERS = {
    it: () => import('./it').then((m) => m.it),
    de: () => import('./de').then((m) => m.de),
    es: () => import('./es').then((m) => m.es),
    fr: () => import('./fr').then((m) => m.fr),
    fa: () => import('./fa').then((m) => m.fa),
    ar: () => import('./ar').then((m) => m.ar),
};

const listeners = new Set();
let version = 0;
export const subscribeLanguages = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};
/** Changes whenever a language pack finishes loading (useSyncExternalStore snapshot). */
export const getLanguagesVersion = () => version;

const pending = new Map();
/** Load a language pack (no-op for English or an already loaded pack). Resolves once translations are available. */
export function loadLanguage(rawCode) {
    const code = normalizeLanguageCode(rawCode);
    if (TRANSLATIONS[code] || !LOADERS[code]) return Promise.resolve();
    if (!pending.has(code)) {
        pending.set(
            code,
            LOADERS[code]()
                .then((pack) => {
                    TRANSLATIONS[code] = pack;
                    version += 1;
                    listeners.forEach((fn) => fn());
                })
                .catch((err) => console.warn('[i18n] could not load language', code, err))
                .finally(() => pending.delete(code))
        );
    }
    return pending.get(code);
}

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
