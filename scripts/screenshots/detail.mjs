import fs from 'node:fs';
import { launch, openApp, out } from './lib.mjs';
const b64 = fs.readFileSync('/tmp/scan/receipt.jpg').toString('base64'); // created by scan.mjs
const browser = await launch();
for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await openApp(browser, { scheme, path: '/' });
    await page.evaluate(async (b) => {
        const bin = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
        const db = await new Promise((res) => { const r = indexedDB.open('wmw-data-v1'); r.onsuccess = () => res(r.result); });
        await new Promise((res) => { const t = db.transaction('images', 'readwrite'); t.objectStore('images').put({ id: 't2', transactionId: 't2', userId: 'demo-user', kind: 'upload', path: 'demo-user/t2.jpg', blob: new Blob([bin], { type: 'image/jpeg' }), status: 'pending' }); t.oncomplete = res; });
    }, b64);
    await page.goto((process.env.BASE_URL || 'http://localhost:4173') + '/receipts/t2');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: out(`detail-${scheme}`) });
    if (scheme === 'light') {
        await page.goto((process.env.BASE_URL || 'http://localhost:4173') + '/receipts/t5');
        await page.waitForTimeout(800);
        await page.screenshot({ path: out('detail-unpaid-light') });
    }
    await ctx.close();
}
await browser.close();
