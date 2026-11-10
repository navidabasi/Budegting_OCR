import { launch, openApp, out } from './lib.mjs';
const browser = await launch();
for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await openApp(browser, { scheme });
    await page.getByRole('button', { name: 'Add receipt' }).click();
    await page.waitForTimeout(500);
    for (const k of ['1', '2', 'Decimal separator', '4', '0']) {
        await page.locator('[data-testid="keypad"]').getByRole('button', { name: k, exact: true }).click();
    }
    await page.getByLabel('Where', { exact: true }).fill('Bar Roma');
    await page.waitForTimeout(300);
    await page.screenshot({ path: out(`quickadd-${scheme}`) });
    await page.getByRole('button', { name: /^More:/ }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: out(`quickadd-more-${scheme}`) });
    await ctx.close();
}
await browser.close();
