// usage: node scripts/screenshots/home.mjs  (Home with an active trip, Home without, empty state)
import { launch, openApp, out, DEMO } from './lib.mjs';
const noTrip = { ...DEMO, groups: DEMO.groups.filter((g) => g.kind !== 'trip'), transactions: DEMO.transactions.filter((t) => !t.groupId || t.groupId === 'g1') };
const empty = { ...DEMO, transactions: [], budgets: [], goals: [] };
const browser = await launch();
for (const scheme of ['light', 'dark']) {
    for (const [data, name, full] of [[DEMO, 'home-trip', true], [noTrip, 'home', true], [empty, 'home-empty', false]]) {
        const { ctx, page } = await openApp(browser, { scheme, data, path: '/', height: full ? 844 : 844 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: out(`${name}-${scheme}`) });
        if (name === 'home-trip' && scheme === 'light') await page.screenshot({ path: out('home-trip-full-light'), fullPage: true });
        await ctx.close();
    }
}
await browser.close();
