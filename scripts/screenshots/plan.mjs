// usage: BASE_URL=http://localhost:4173 node scripts/screenshots/plan.mjs [budgets|savings|trips ...]
import { launch, openApp, out } from './lib.mjs';
const tabs = process.argv.slice(2).length ? process.argv.slice(2) : ['budgets'];
const browser = await launch();
for (const tab of tabs) {
    for (const scheme of ['light', 'dark']) {
        const { ctx, page } = await openApp(browser, { scheme, path: tab === 'budgets' ? '/plan' : `/plan?tab=${tab}` });
        await page.screenshot({ path: out(`${tab}-${scheme}`) });
        await ctx.close();
    }
}
await browser.close();
