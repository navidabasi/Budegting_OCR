// Section 11 in a real browser: tokens, sheet slide + exit, reduced motion from the device and from the app setting.
//   node scripts/e2e/motion.mjs   (needs `vite preview` on :4173)
import { launch, openApp } from '../screenshots/lib.mjs';
import { data } from './fixtures.mjs';
let failures = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
};
const browser = await launch();
const panelAnim = (page) => page.evaluate(() => { const p = document.querySelector('[role="dialog"]'); return p ? getComputedStyle(p).animationName : null; });

async function scenario({ os, setting }) {
    const { ctx, page } = await openApp(browser, { data, path: '/', width: 390, height: 844 });
    if (os) await page.emulateMedia({ reducedMotion: os });
    if (setting) {
        await page.addInitScript((m) => { const k = 'receipt-manager-storage'; const v = JSON.parse(localStorage.getItem(k)); v.state.motionMode = m; localStorage.setItem(k, JSON.stringify(v)); }, setting); // runs after the helper's own init script
        await page.reload();
        await page.waitForTimeout(800);
    }
    await page.click('button[aria-label="Add receipt"]');
    await page.waitForTimeout(40);
    const anim = await panelAnim(page);
    const motion = await page.evaluate(() => document.documentElement.dataset.motion);
    await page.waitForTimeout(400);
    await page.click('[data-testid="quickadd-close"]');
    await page.waitForTimeout(40);
    const leaving = await panelAnim(page);
    await page.waitForTimeout(450);
    const gone = (await page.locator('[role="dialog"]').count()) === 0;
    await ctx.close();
    return { anim, motion, leaving, gone };
}
const full = await scenario({});
check('full motion: the sheet slides up (260 ms token)', full.anim === 'sheet-up' && full.motion === 'full', JSON.stringify(full));
check('full motion: the sheet slides down on close and then unmounts', full.leaving === 'sheet-down' && full.gone, JSON.stringify(full));
const os = await scenario({ os: 'reduce' });
check('device asks for reduced motion: the sheet only fades (no travel)', os.anim === 'fade-in' && os.motion === 'reduced', JSON.stringify(os));
check('device asks for reduced motion: the sheet closes at once', os.leaving === null && os.gone, JSON.stringify(os));
const app = await scenario({ setting: 'reduced' });
check('app setting "Always reduce" removes the travel without any device setting', app.anim === 'fade-in' && app.motion === 'reduced', JSON.stringify(app));
const forced = await scenario({ os: 'reduce', setting: 'full' });
check('app setting "Full motion" overrides the device', forced.anim === 'sheet-up' && forced.motion === 'full', JSON.stringify(forced));
{
    const { ctx, page } = await openApp(browser, { data, path: '/plan', width: 390, height: 844 });
    const info = await page.evaluate(() => {
        const bar = document.querySelector('[role="progressbar"] > div');
        const cs = bar && getComputedStyle(bar);
        return { bar: cs && [cs.transitionProperty, cs.transitionDuration] };
    });
    await page.goto('http://localhost:4173/activity');
    await page.waitForTimeout(800);
    info.chip = await page.evaluate(() => getComputedStyle(document.querySelector('button[aria-pressed]')).transitionDuration);
    check('budget bars animate transform only (no width/layout transition), 260 ms', !!info.bar && info.bar[0] === 'transform' && info.bar[1] === '0.26s', JSON.stringify(info));
    check('press feedback uses the 120 ms token', info.chip === '0.12s', JSON.stringify(info));
    await ctx.close();
}
{
    const { ctx, page } = await openApp(browser, { data, path: '/', width: 390, height: 844 });
    await page.goto('http://localhost:4173/settings');
    await page.waitForTimeout(800);
    await page.getByLabel('Always reduce').check();
    await page.waitForTimeout(200);
    check('Settings: choosing "Always reduce" applies at once', (await page.evaluate(() => document.documentElement.dataset.motion)) === 'reduced' && /reduced/i.test(await page.locator('[data-testid="motion-state"]').innerText()));
    await ctx.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
