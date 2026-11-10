/** Scanning preferences (per device): keep the receipt photo, read line items. Both default to on. */
const KEY = 'wmw.scanPrefs';
const DEFAULTS = { saveImages: true, readItems: true };

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
