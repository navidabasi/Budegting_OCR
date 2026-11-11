// Pass 2 part 2 screenshots: node scripts/screenshots/pass2b.mjs (needs `vite preview` on :4173). Synthetic data only.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { launch, openApp } from './lib.mjs';
import { data, LONG } from '../e2e/fixtures.mjs';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const OUT = 'docs/screenshots/pass2';
fs.mkdirSync('/tmp/scan', { recursive: true });
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#dde3df"/><rect x="100" y="40" width="400" height="800" fill="#fbfbf7"/>${['LIDL ITALIA', 'LATTE INTERO 1L   1,19', 'PANE CASERECCIO   2,49', 'TOTALE EURO      23,47'].map((l, i) => `<text x="130" y="${100 + i * 40}" font-family="monospace" font-size="24" fill="#2b3b34">${l}</text>`).join('')}</svg>`)).jpeg().toFile('/tmp/scan/receipt.jpg');

const TOKEN = () => localStorage.setItem('sb-your-project-id-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: 'demo-user' } }));
const narrative = { headline: 'Groceries are the story of this month', summary: 'Spending is led by groceries; most of it is explained by two supermarket trips.', wins: ['Dining is under its budget'], concerns: [], actions: [], questions: [], generatedAt: new Date().toISOString(), model: 'deepseek-flash', cached: false };
const scan = { receipt: { merchant: 'Lidl', date: new Date().toISOString().slice(0, 10), total: 23.47, currency: 'EUR', paymentMethod: 'card', category: 'Groceries', items: [{ name: 'Latte intero 1L', quantity: 1, price: 1.19 }, { name: 'Pane casereccio', quantity: 1, price: 2.49 }, { name: '', quantity: 1, price: 0.99 }], confidence: { merchant: 0.95, date: 0.9, total: 0.45, items: 0.6 } }, extraction: { provider: 'vision', model: 'mock' } };
const shot = (page, name, scheme, w) => page.screenshot({ path: `${OUT}/${name}-${w ? `${w}-` : ''}${scheme}.png` });

const browser = await launch();
const wire = async (ctx, page) => {
    await ctx.addInitScript(TOKEN);
    await page.reload();
    await page.waitForTimeout(700);
    await page.route('**/api/insights', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(narrative) }));
    await page.route('**/api/chat', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: 'Groceries are 142 of the 150 spent at supermarkets so far; item detail covers part of it, the rest has no lines yet.', citations: ['F2', 'F3', 'F4'], uncertain: ['F3'], proposals: [], model: 'deepseek-flash' }) }));
    await page.route('**/api/extract-receipt', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scan) }));
};

for (const scheme of ['light', 'dark']) {
    // chat with evidence + settings inspector + conversion card + quick add with keyboard
    {
        const { ctx, page } = await openApp(browser, { scheme, data, path: '/insights', width: 390, height: 844 });
        await wire(ctx, page);
        await page.getByRole('button', { name: 'Where did grocery money go?' }).click();
        await page.waitForSelector('[data-testid="evidence"]');
        await page.click('[data-testid="evidence-toggle"]');
        await page.waitForTimeout(500);
        await page.evaluate(() => document.querySelector('[data-testid="evidence"]').scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(300);
        await shot(page, 'assistant-evidence', scheme);
        await page.goto('http://localhost:4173/settings');
        await page.waitForTimeout(900);
        await page.getByText('AI & scanning').first().scrollIntoViewIfNeeded();
        await page.click('[data-testid="ai-boundary"] summary');
        await page.waitForTimeout(400);
        await page.evaluate(() => document.querySelector('[data-testid="ai-boundary"]').scrollIntoView({ block: 'start' }));
        await shot(page, 'settings-ai-boundary', scheme);
        await page.goto('http://localhost:4173/receipts/fx1');
        await page.waitForTimeout(1000);
        await shot(page, 'conversion-card', scheme);
        await page.click('[data-testid="fx-edit"]');
        await page.waitForTimeout(500);
        await shot(page, 'conversion-sheet', scheme);
        await ctx.close();
    }
    {
        const { ctx, page } = await openApp(browser, { scheme, data, path: '/', width: 390, height: 844 });
        await page.click('button[aria-label="Add receipt"]');
        await page.waitForTimeout(500);
        await page.setViewportSize({ width: 390, height: 430 });
        await page.waitForTimeout(300);
        await page.locator('#qa-merchant').click();
        await page.waitForTimeout(500);
        await shot(page, 'quickadd-keyboard', scheme);
        await ctx.close();
    }
    {
        const { ctx, page } = await openApp(browser, { scheme, data, path: '/scan', width: 390, height: 844 });
        await ctx.addInitScript(() => localStorage.setItem('wmw.scanPrefs', JSON.stringify({ cropFirst: true })));
        await wire(ctx, page);
        await page.setInputFiles('[data-testid="scan-file-input"]', '/tmp/scan/receipt.jpg');
        await page.waitForSelector('[data-testid="crop-step"]', { timeout: 15000 });
        await page.waitForTimeout(400);
        await shot(page, 'scan-crop', scheme);
        await ctx.close();
    }
    {
        const { ctx, page } = await openApp(browser, { scheme, data, path: '/activity', width: 390, height: 844 });
        await shot(page, 'activity-long-names', scheme);
        await ctx.close();
    }
}
for (const scheme of ['light', 'dark']) {
    for (const [w, h] of [[820, 1180], [1280, 800]]) {
        const { ctx, page } = await openApp(browser, { scheme, data, path: '/activity', width: w, height: h });
        await page.locator('[data-testid="transaction-row"], [data-testid="activity-row"]').nth(1).click().catch(() => {});
        await page.locator('[data-testid="transaction-row"] button').nth(1).click().catch(() => {});
        await page.waitForTimeout(800);
        await shot(page, 'activity-panes', scheme, w);
        if (w === 820) {
            const s = await openApp(browser, { scheme, data, path: '/scan', width: w, height: h });
            await wire(s.ctx, s.page);
            await s.page.setInputFiles('[data-testid="scan-file-input"]', '/tmp/scan/receipt.jpg');
            await s.page.waitForSelector('[data-testid="review-layout"]', { timeout: 15000 });
            await s.page.waitForTimeout(600);
            await shot(s.page, 'scan-review-panes', scheme, w);
            await s.ctx.close();
        } else {
            const s = await openApp(browser, { scheme, data, path: '/insights', width: w, height: h });
            await wire(s.ctx, s.page);
            await s.page.getByRole('button', { name: 'Where did grocery money go?' }).click();
            await s.page.waitForSelector('[data-testid="evidence"]');
            await s.page.waitForTimeout(500);
            await shot(s.page, 'assistant-evidence', scheme, w);
            await s.ctx.close();
        }
        await ctx.close();
    }
}
await browser.close();
console.log('done');
process.exit(0);
