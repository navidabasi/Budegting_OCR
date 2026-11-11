// usage: node scripts/screenshots/trip.mjs  (Trip page + Plan > Trips)
import { launch, openApp, out } from './lib.mjs';
const browser = await launch();
for (const scheme of ['light', 'dark']) {
    for (const [path, name] of [['/trips/g2', 'trip'], ['/plan?tab=trips', 'trips']]) {
        const { ctx, page } = await openApp(browser, { scheme, path });
        await page.screenshot({ path: out(`${name}-${scheme}`) });
        await ctx.close();
    }
}
await browser.close();
