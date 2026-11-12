// Kept for pages loaded from builds before src/services/swUpdate.js: they still request this file. It registers the same
// worker; once that worker takes over, the app reloads into the current build, which registers itself.
if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }); }); }
