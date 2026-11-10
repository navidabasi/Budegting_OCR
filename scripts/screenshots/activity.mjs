import { launch, openApp, out } from './lib.mjs';
const browser = await launch();
for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await openApp(browser, { scheme, path: '/activity' });
    await page.screenshot({ path: out(`activity-${scheme}`) });
    if (scheme === 'light') {
        // swipe the first row left (delete revealed) with real pointer events
        const row = page.locator('[data-testid="transaction-row"]').first();
        const box = await row.boundingBox();
        await page.mouse.move(box.x + 300, box.y + 30);
        await page.mouse.down();
        await page.mouse.move(box.x + 250, box.y + 30, { steps: 5 });
        await page.mouse.move(box.x + 200, box.y + 30, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        await page.screenshot({ path: out('activity-swipe-light') });
        // URL filters + amount search
        await page.goto(process.env.BASE_URL ? process.env.BASE_URL + '/activity?q=23,47&m=all' : 'http://localhost:4173/activity?q=23,47&m=all');
        await page.waitForTimeout(800);
        console.log('amount search rows:', await page.locator('[data-testid="transaction-row"]').count());
    }
    await ctx.close();
}
await browser.close();
