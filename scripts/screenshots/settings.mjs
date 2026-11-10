import { launch, openApp, out, DEMO } from './lib.mjs';
const browser = await launch();
for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await openApp(browser, { scheme, path: '/welcome', data: { settings: DEMO.settings } });
    await page.screenshot({ path: out(`onboarding-1-${scheme}`) });
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: out(`onboarding-2-${scheme}`) });
    if (scheme === 'light') {
        await page.getByRole('button', { name: 'Next' }).click();
        await page.screenshot({ path: out('onboarding-3-light') });
    }
    await ctx.close();
    const s = await openApp(browser, { scheme, path: '/' });
    await s.page.locator('button:has(svg.lucide-settings)').first().click();
    await s.page.waitForTimeout(600);
    await s.page.screenshot({ path: out(`settings-${scheme}`), fullPage: false });
    await s.ctx.close();
}
// RTL check (Persian): activity + quick add
const faData = { ...DEMO, settings: [{ ...DEMO.settings[0], languageCode: 'fa' }] };
const fa = await openApp(browser, { scheme: 'light', lang: 'fa', path: '/activity', data: faData });
await fa.page.screenshot({ path: out('activity-fa-rtl') });
await fa.page.locator('nav button').first().click();
await fa.page.waitForTimeout(500);
await fa.page.screenshot({ path: out('quickadd-fa-rtl') });
await fa.ctx.close();
await browser.close();
