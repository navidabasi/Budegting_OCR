// Keeps the installed app (home screen) on the latest deploy.
//
// Why this exists: the service worker answers navigations from its precache, so an open or resumed app runs the build it was
// installed with. A home-screen app is usually resumed rather than reloaded, so the browser rarely even checks for a new
// service worker. The plugin's default registration only registered the worker: nothing ever moved the open app to the new
// build, which is why the app showed the previous version.
//
// Here: register the worker, check for a new version whenever the app comes back to the front, when the device is
// back online and every 30 minutes; when a new version takes control (src/sw.js skips waiting), reload into it. A reload
// never interrupts typing: it waits until the field is left or the app goes to the background.
const CHECK_EVERY_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 10 * 1000; // a check only fetches the small, uncached /sw.js
const RELOAD_GUARD_KEY = 'wmw-chunk-reload';

const isEditing = (doc) => {
    const el = doc.activeElement;
    if (!el) return false;
    const tag = String(el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
};

/**
 * startUpdates({ workbox, doc, win, now }) -> { check() }. Dependencies are injected so the logic can be tested without a browser.
 */
export function startUpdates({ workbox, doc = document, win = window, now = () => Date.now() }) {
    let lastCheck = -Infinity;
    let pendingReload = false;
    let reloaded = false;

    const reload = () => {
        if (reloaded) return;
        reloaded = true;
        win.location.reload();
    };
    const reloadWhenSafe = () => {
        if (doc.hidden || !isEditing(doc)) reload();
        else pendingReload = true;
    };
    const check = () => {
        const t = now();
        if (t - lastCheck < MIN_GAP_MS) return;
        lastCheck = t;
        workbox.update().catch(() => {
            /* offline or the server is unreachable: the next check tries again */
        });
    };

    // a new service worker took control of this page: it holds the new build
    workbox.addEventListener('controlling', (event) => {
        if (event?.isUpdate || event?.isExternal) reloadWhenSafe();
    });
    doc.addEventListener('visibilitychange', () => {
        if (doc.hidden) {
            if (pendingReload) reload();
        } else check();
    });
    doc.addEventListener('focusout', () => {
        if (pendingReload && !isEditing(doc)) reload();
    });
    win.addEventListener('online', check);
    win.addEventListener('focus', check);
    win.setInterval(check, CHECK_EVERY_MS);

    // An open tab from before a deploy asks for code chunks that the new deploy no longer has: reload once into the new build
    win.addEventListener('vite:preloadError', (event) => {
        let last = null;
        try {
            last = win.sessionStorage.getItem(RELOAD_GUARD_KEY);
        } catch {
            /* storage unavailable */
        }
        if (last && now() - Number(last) < MIN_GAP_MS) return; // already tried: let the error surface instead of looping
        try {
            win.sessionStorage.setItem(RELOAD_GUARD_KEY, String(now()));
        } catch {
            /* storage unavailable */
        }
        event?.preventDefault?.();
        reload();
    });

    workbox.register({ immediate: true }).catch((err) => console.warn('[sw] registration failed', err));
    return { check };
}

/** Production only: register /sw.js with update checks. Never throws. */
export async function registerServiceWorker() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    try {
        const { Workbox } = await import('workbox-window');
        return startUpdates({ workbox: new Workbox('/sw.js', { scope: '/' }) });
    } catch (err) {
        console.warn('[sw] could not start', err);
        return null;
    }
}
