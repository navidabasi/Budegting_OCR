/**
 * Scanning preferences (per device): keep the receipt photo (default off: the owner only needs the extracted data), read line
 * items, send the photo to the AI provider (default on, the owner allowed it), and pause to crop the photo before it is sent
 * (default off).
 */
const KEY = 'wmw.scanPrefs';
const DEFAULTS = { saveImages: false, readItems: true, sendPhotos: true, cropFirst: false };
const PHOTOS_OFF_MIGRATION = 'photosOffV1'; // keeping photos used to default on: switch it off once on every device

export function getScanPrefs() {
    try {
        const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
        if (!stored[PHOTOS_OFF_MIGRATION]) {
            stored.saveImages = false;
            stored[PHOTOS_OFF_MIGRATION] = true;
            try {
                localStorage.setItem(KEY, JSON.stringify(stored));
            } catch {
                /* storage blocked */
            }
        }
        return { ...DEFAULTS, ...stored };
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
