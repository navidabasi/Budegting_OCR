/** Per-device conveniences in localStorage (collapsed sections, recent searches). Every access is guarded: storage can be blocked. */
export function readDevice(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}

export function writeDevice(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* storage blocked: the value lasts until reload */
    }
}

/** Most recent first, unique (case-insensitive), at most `max`. */
export function pushRecent(list = [], value, max = 6) {
    const v = String(value || '').trim();
    if (!v) return list;
    return [v, ...list.filter((x) => String(x).toLowerCase() !== v.toLowerCase())].slice(0, max);
}
