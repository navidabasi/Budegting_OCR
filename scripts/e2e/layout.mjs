// Brief section 12 case 12: phone / tablet / PC with long names, large text, keyboard, empty/error states. Real browser checks.
//   npm run build && npx vite preview --port 4173 &     then     node scripts/e2e/layout.mjs
// Exits non-zero when a check fails. Synthetic data only (scripts/e2e/fixtures.mjs).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { launch, openApp, BASE } from '../screenshots/lib.mjs';
import { data, LONG } from './fixtures.mjs';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

let failures = 0;
const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const inView = async (page, loc) => {
    const b = await loc.boundingBox();
    const vp = page.viewportSize();
    return !!b && b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1;
};

const browser = await launch();
const open = (opts) => openApp(browser, { data, ...opts });

// ------------------------------------------------------------------ phone 390 x 844
{
    const { ctx, page } = await open({ path: '/activity', width: 390, height: 844 });
    check('phone: Activity has no horizontal overflow with 40+ character merchant names', (await overflow(page)) <= 1, `${await overflow(page)}px`);
    check('phone: Activity shows the single-pane list (no detail pane)', (await page.locator('[data-testid="detail-pane"]').count()) === 0);
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(300);
    const y0 = await page.evaluate(() => window.scrollY);
    await page.locator('[data-testid="transaction-row"]').nth(3).locator('button').last().click();
    await page.waitForTimeout(700);
    const opened = page.url().includes('/receipts/');
    check('phone: tapping a row opens the detail page', opened, page.url());
    if (opened) {
        check('phone: detail with a long merchant name has no horizontal overflow', (await overflow(page)) <= 1);
        await page.goBack();
        await page.waitForTimeout(900);
        const y1 = await page.evaluate(() => window.scrollY);
        check('phone: back returns to Activity with the same filters and scroll position', page.url().includes('/activity') && Math.abs(y1 - y0) < 80, `${y0} -> ${y1}`);
    }
    await ctx.close();
}
{
    // Settings is a real route with its own header and back button
    const { ctx, page } = await open({ path: '/', width: 390, height: 844 });
    await page.click('button[aria-label="Settings"]');
    await page.waitForTimeout(600);
    check('phone: Settings opens as a route (/settings) with a header', page.url().endsWith('/settings') && (await page.locator('[data-testid="settings-route"] h1').count()) === 1);
    await page.click('[data-testid="settings-route"] button[aria-label="Back"]');
    await page.waitForTimeout(500);
    check('phone: Settings back returns to Home', new URL(page.url()).pathname === '/');
    await ctx.close();
}
{
    // Quick Add: keyboard open and 200 % text keep the amount, the merchant field and Save reachable
    const { ctx, page } = await open({ path: '/', width: 390, height: 844 });
    await page.click('button[aria-label="Add receipt"]');
    await page.waitForTimeout(500);
    const merchant = page.locator('#qa-merchant');
    await page.setViewportSize({ width: 390, height: 430 }); // the keyboard takes ~ half the screen (a resize drops focus in the test browser, so focus after it)
    await page.waitForTimeout(300);
    await merchant.click();
    await page.waitForTimeout(400);
    check('phone: Quick Add swaps the keypad for a compact Save bar while typing', (await page.locator('[data-testid="compact-save-bar"]').count()) === 1);
    const save = page.locator('[data-testid="compact-save-bar"] button').last();
    check('phone: Quick Add Save is inside the visible area with the keyboard open', await inView(page, save));
    check('phone: Quick Add merchant field is visible with the keyboard open', await inView(page, merchant));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.activeElement?.blur());
    await page.addStyleTag({ content: 'html { font-size: 20px }' });
    await page.waitForTimeout(400);
    check('phone: Quick Add at 200 % text has no horizontal overflow', (await overflow(page)) <= 1, `${await overflow(page)}px`);
    const saveBtn = page.getByRole('button', { name: 'Save', exact: true }).last();
    await saveBtn.scrollIntoViewIfNeeded();
    check('phone: Quick Add at 200 % text keeps Save reachable', await inView(page, saveBtn));
    await ctx.close();
}
{
    // Chat with the keyboard open: the input is above the keyboard and the bottom nav is gone
    const { ctx, page } = await open({ path: '/insights', width: 390, height: 844 });
    const input = page.getByLabel('Ask about your spending');
    await page.setViewportSize({ width: 390, height: 430 });
    await page.waitForTimeout(300);
    await input.click();
    await page.waitForTimeout(400);
    check('phone: chat input stays visible with the keyboard open', await inView(page, input));
    check('phone: bottom nav does not cover the chat input while typing', (await page.locator('nav[aria-label="Main navigation"]:visible').count()) === 0 || !(await page.locator('nav[aria-label="Main navigation"]').first().isVisible()));
    await ctx.close();
}
{
    // Scan review: 200 % text and the keyboard
    fs.mkdirSync('/tmp/scan', { recursive: true });
    const lines = ['LIDL', 'LATTE 1,19', 'TOTALE 23,47'];
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#fbfbf7"/>${lines.map((l, i) => `<text x="60" y="${100 + i * 40}" font-size="28">${l}</text>`).join('')}</svg>`)).jpeg().toFile('/tmp/scan/receipt.jpg');
    const response = { receipt: { merchant: LONG, merchantRaw: LONG, date: new Date().toISOString().slice(0, 10), total: 23.47, currency: 'EUR', paymentMethod: 'card', category: 'Groceries', items: [{ name: 'Latte intero parzialmente scremato 1L', quantity: 1, price: 1.19 }, { name: '', quantity: 1, price: 0.99 }], confidence: { merchant: 0.95, date: 0.9, total: 0.45, items: 0.6 } }, extraction: { provider: 'vision', model: 'mock' } };
    for (const [w, h, label] of [[390, 844, 'phone'], [820, 1180, 'tablet']]) {
        const { ctx, page } = await open({ path: '/scan', width: w, height: h });
        await ctx.addInitScript(() => localStorage.setItem('sb-your-project-id-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: 'demo-user' } })));
        await page.reload();
        await page.waitForTimeout(600);
        await page.route('**/api/extract-receipt', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) }));
        await page.setInputFiles('[data-testid="scan-file-input"]', '/tmp/scan/receipt.jpg');
        await page.waitForSelector('[data-testid="review-layout"]', { timeout: 15000 });
        await page.waitForTimeout(400);
        check(`${label}: Scan review with a long merchant name has no horizontal overflow`, (await overflow(page)) <= 1, `${await overflow(page)}px`);
        if (label === 'tablet') {
            const photo = page.locator('[data-testid="review-photo-pane"]');
            const form = page.locator('#scan-merchant');
            const pb = await photo.boundingBox();
            const fb = await form.boundingBox();
            check('tablet: Scan shows the photo and the review form side by side', !!pb && !!fb && pb.x + pb.width <= fb.x + 2 && pb.height > 400, JSON.stringify({ pb, fb }));
        } else {
            await page.setViewportSize({ width: w, height: 430 });
            await page.waitForTimeout(300);
            await page.locator('#scan-merchant').click();
            await page.waitForTimeout(400);
            check('phone: Scan review keeps Save reachable with the keyboard open', await inView(page, page.getByRole('button', { name: /^Save/ }).first()));
            await page.setViewportSize({ width: w, height: h });
            await page.evaluate(() => document.activeElement?.blur());
            await page.addStyleTag({ content: 'html { font-size: 20px }' });
            await page.waitForTimeout(400);
            check('phone: Scan review at 200 % text has no horizontal overflow', (await overflow(page)) <= 1, `${await overflow(page)}px`);
            const s = page.getByRole('button', { name: /^Save/ }).first();
            await s.scrollIntoViewIfNeeded();
            check('phone: Scan review at 200 % text keeps Save reachable', await inView(page, s));
        }
        await ctx.close();
    }
}

// ------------------------------------------------------------------ tablet 820 x 1180
{
    const { ctx, page } = await open({ path: '/activity', width: 820, height: 1180 });
    check('tablet: Activity shows the list and the detail pane side by side', (await page.locator('[data-testid="detail-pane"]').count()) === 1 && (await page.locator('[data-layout="tablet"]').count()) === 1);
    check('tablet: Activity has no horizontal overflow', (await overflow(page)) <= 1);
    check('tablet: the detail pane starts with a prompt', (await page.locator('[data-testid="detail-empty"]').count()) === 1);
    await page.locator('[data-testid="transaction-row"]').nth(1).locator('button').last().click();
    await page.waitForTimeout(700);
    check('tablet: selecting a transaction keeps the list and fills the detail pane (?sel= in the URL)', page.url().includes('sel=') && (await page.locator('[data-testid="detail-embedded"]').count()) === 1, page.url());
    await ctx.close();
}

// ------------------------------------------------------------------ PC 1280 x 800
{
    const { ctx, page } = await open({ path: '/activity', width: 1280, height: 800 });
    check('PC: left nav rail is visible', await page.locator('[data-testid="nav-rail"]').isVisible());
    check('PC: bottom nav is hidden', (await page.locator('nav:has(button[aria-label="Add receipt"]):not([data-testid="nav-rail"])').count()) === 0 || !(await page.locator('nav:has(button[aria-label="Add receipt"]):not([data-testid="nav-rail"])').first().isVisible()));
    check('PC: Activity is a table with a detail pane', (await page.locator('[role="table"]').count()) === 1 && (await page.locator('[data-testid="detail-pane"]').count()) === 1);
    check('PC: no horizontal overflow', (await overflow(page)) <= 1, `${await overflow(page)}px`);
    const amounts = async () => page.locator('[data-testid="activity-row"]').evaluateAll((rows) => rows.slice(0, 6).map((r) => parseFloat(r.querySelector('[role="cell"]:last-child').textContent.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'))));
    await page.click('[data-testid="sort-amount"]');
    await page.waitForTimeout(500);
    const desc = (await amounts()).map(Math.abs);
    check('PC: clicking Amount sorts the table (largest first) and marks the column', desc.every((v, i) => i === 0 || desc[i - 1] >= v) && (await page.locator('[role="columnheader"][aria-sort="descending"]').count()) === 1, JSON.stringify(desc));
    await page.click('[data-testid="sort-amount"]');
    await page.waitForTimeout(400);
    const asc = (await amounts()).map(Math.abs);
    check('PC: clicking again reverses the sort', asc.every((v, i) => i === 0 || asc[i - 1] <= v) && (await page.locator('[role="columnheader"][aria-sort="ascending"]').count()) === 1, JSON.stringify(asc));
    await page.locator('body').click({ position: { x: 700, y: 20 } });
    await page.keyboard.press('j');
    await page.waitForTimeout(300);
    const sel1 = await page.locator('[data-testid="activity-row"][data-selected="true"]').count();
    check('PC: j selects the first row and its detail shows in the pane', sel1 === 1 && (await page.locator('[data-testid="detail-embedded"]').count()) === 1);
    const first = await page.locator('[data-testid="activity-row"][data-selected="true"]').innerText();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    const second = await page.locator('[data-testid="activity-row"][data-selected="true"]').innerText();
    check('PC: arrow down moves the selection', first !== second);
    await page.keyboard.press('k');
    await page.waitForTimeout(300);
    check('PC: k moves back up', (await page.locator('[data-testid="activity-row"][data-selected="true"]').innerText()) === first);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    check('PC: Enter moves the focus to the detail pane', await page.evaluate(() => !!document.activeElement?.closest('[data-testid="detail-pane"]') || document.activeElement?.getAttribute('data-testid') === 'detail-pane'));
    await page.locator('body').click({ position: { x: 700, y: 20 } });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('PC: Esc clears the selection', (await page.locator('[data-testid="activity-row"][data-selected="true"]').count()) === 0 && !page.url().includes('sel='));
    await page.click('[data-testid="nav-rail"] a[aria-label="Settings"]');
    await page.waitForTimeout(500);
    check('PC: Settings is reachable from the rail', page.url().endsWith('/settings'));
    await ctx.close();
}
{
    // same financial logic: the Home total on the three sizes is the same number
    const totals = [];
    for (const [w, h] of [[390, 844], [820, 1180], [1280, 800]]) {
        const { ctx, page } = await open({ path: '/', width: w, height: h });
        totals.push(await page.locator('main').first().innerText().then((t) => (t.match(/(\d[\d.,]*)\s*€?\s*\n?.*spent/i) || [])[1] || t.slice(0, 80)));
        await ctx.close();
    }
    check('all sizes: Home shows the same spending figure', new Set(totals).size === 1, JSON.stringify(totals));
}
// ------------------------------------------------------------------ empty state
{
    const { ctx, page } = await open({ path: '/activity', width: 390, height: 844, data: { ...data, transactions: [] } });
    await page.waitForTimeout(500);
    const emptyCount = /No transactions yet/i.test(await page.locator('main').first().innerText()) ? 1 : 0;
    check('phone: empty Activity says so and has no overflow', emptyCount >= 1 && (await overflow(page)) <= 1, `count=${emptyCount} overflow=${await overflow(page)}`);
    await ctx.close();
}

await browser.close();
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
