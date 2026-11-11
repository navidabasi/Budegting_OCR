// usage: node scripts/screenshots/insights.mjs  (the AI card shows its error state: no Supabase session locally)
import { launch, openApp, out } from './lib.mjs';
const browser = await launch();
for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await openApp(browser, { scheme, path: '/insights' });
    await page.screenshot({ path: out(`insights-${scheme}`) });
    await ctx.close();
}
await browser.close();
