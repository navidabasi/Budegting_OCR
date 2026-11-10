import { createRequire } from 'node:module';
import fs from 'node:fs';
import { launch, openApp, out, BASE } from './lib.mjs';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const lines = ['LIDL ITALIA S.R.L.', 'VIA DEI MILLE 12 - 10100 TORINO', 'DOCUMENTO COMMERCIALE', 'LATTE INTERO 1L      1,19', 'PANE CASERECCIO      2,49', 'BANANE 0,812KG       1,29', 'UOVA M 10PZ          2,79', 'PASTA BARILLA 500G   0,99', 'CAFFE LAVAZZA 250G   3,49', '', 'TOTALE EURO         23,47', 'CARTA               23,47'];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#dde3df"/><rect x="100" y="40" width="400" height="800" fill="#fbfbf7"/>${lines.map((l, i) => `<text x="130" y="${100 + i * 40}" font-family="monospace" font-size="24" fill="#2b3b34">${l.replace(/&/g, '&amp;')}</text>`).join('')}</svg>`;
fs.mkdirSync('/tmp/scan', { recursive: true });
await sharp(Buffer.from(svg)).jpeg().toFile('/tmp/scan/receipt.jpg');

const RESPONSE = { receipt: { merchant: 'Lidl', merchantRaw: 'LIDL ITALIA S.R.L.', date: new Date().toISOString().slice(0, 10), time: '18:42', total: 23.47, currency: 'EUR', paymentMethod: 'card', category: 'Groceries',
    items: [{ name: 'Latte intero 1L', quantity: 1, price: 1.19 }, { name: 'Pane casereccio', quantity: 1, price: 2.49 }, { name: 'Banane 0,812 kg', quantity: 1, price: 1.29 }, { name: 'Uova M 10 pz', quantity: 1, price: 2.79 }, { name: '', quantity: 1, price: 0.99 }, { name: 'Caffe Lavazza', quantity: 1, price: null }],
    tax: 2.11, confidence: { merchant: 0.95, date: 0.9, total: 0.45, items: 0.6 } }, extraction: { provider: 'vision', model: 'mock', durationMs: 1200 } };

const browser = await launch();
for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await openApp(browser, { scheme, path: '/scan' });
    await ctx.addInitScript(() => localStorage.setItem('sb-your-project-id-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: 'demo-user' } })));
    await page.reload();
    await page.waitForTimeout(600);
    await page.route('**/api/extract-receipt', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESPONSE) }));
    await page.screenshot({ path: out(`scan-start-${scheme}`) });
    await page.setInputFiles('[data-testid="scan-file-input"]', '/tmp/scan/receipt.jpg');
    await page.waitForSelector('text=Check the scan', { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: out(`scan-review-${scheme}`) });
    await ctx.close();
}
await browser.close();
