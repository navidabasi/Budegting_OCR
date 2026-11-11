/**
 * Scanning preferences (per device): keep the receipt photo, read line items, send the photo to the AI provider (default on, the
 * owner allowed it), and pause to crop the photo before it is sent (default off).
 */
const KEY = 'wmw.scanPrefs';
const DEFAULTS = { saveImages: true, readItems: true, sendPhotos: true, cropFirst: false };

export function getScanPrefs() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
        return { ...DEFAULTS };
    }
}

export function setScanPrefs(patch) {
    const next = { ...getScanPrefs(), ...patch };
    try {
        localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
        /* storage blocked: the preference lasts until reload */
    }
    return next;
}
