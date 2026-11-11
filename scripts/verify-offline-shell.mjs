// Verifies that the installed app shell reopens with no network: load once with the service worker, go offline, reload deep links.
// usage: npm run build && npx vite preview --port 4173 & node scripts/verify-offline-shell.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:4173';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
    localStorage.setItem('receipt-manager-storage', JSON.stringify({ state: { currentUser: { userId: 'demo-user', email: 'd@e.f' }, isAuthenticated: true, darkMode: false, darkModeManual: false, languageCode: 'en' }, version: 0 }));
});
await page.goto(BASE + '/activity');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForFunction(() => navigator.serviceWorker.controller || true);
await page.reload(); // controlled by the SW from now on
await page.waitForTimeout(1500);
await ctx.setOffline(true);
const results = [];
for (const path of ['/activity', '/plan', '/receipts/abc', '/']) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const info = await page.evaluate(() => ({ root: document.getElementById('root')?.children.length || 0, text: document.body.innerText.slice(0, 80).replace(/\n/g, ' | ') }));
    results.push({ path, ...info });
}
console.log(JSON.stringify(results, null, 1));
const failed = results.filter((r) => r.root === 0);
await browser.close();
process.exit(failed.length ? 1 : 0);
