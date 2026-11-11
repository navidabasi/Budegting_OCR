// Pass 3 screenshots: node scripts/screenshots/pass3.mjs [name ...]  (needs `vite preview` on :4173). Synthetic data only.
// Writes docs/screenshots/pass3/<name>-<scheme>.png (390x844) and <name>-1280-<scheme>.png.
import fs from 'node:fs';
import { launch, openApp } from './lib.mjs';
import { pass3 } from './pass3-data.mjs';

const OUT = 'docs/screenshots/pass3';
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const TOKEN = () => localStorage.setItem('sb-your-project-id-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: 'demo-user' } }));
export const shots = {};
const def = (name, fn, { wide = false, path = '/', auth = false } = {}) => (shots[name] = { fn, wide, path, auth });

def('activity', async () => {}, { wide: true, path: '/activity' });
def('activity-group-picker', async (page) => {
    await page.click('[data-testid="chip-group"]');
    await page.waitForTimeout(450);
}, { path: '/activity' });
def('activity-grouped', async (page) => {
    await page.click('[data-testid="view-button"]');
    await page.waitForTimeout(300);
    await page.click('[data-testid="group-by"] [role="radio"]:nth-child(2)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
}, { wide: true, path: '/activity?m=all' });
def('activity-view-sheet', async (page) => {
    await page.click('[data-testid="view-button"]');
    await page.waitForTimeout(450);
}, { path: '/activity' });
def('groups', async () => {}, { wide: true, path: '/groups' });
def('group-detail', async () => {}, { wide: true, path: '/groups/g-debts' });
def('group-add', async (page) => {
    await page.click('[data-testid="group-add"]');
    await page.waitForTimeout(450);
    await page.locator('[data-testid="add-candidate"]').nth(1).click();
}, { path: '/groups/g-gifts' });
def('home-groups', async (page) => {
    await page.evaluate(() => document.querySelector('[data-testid="home-groups"]')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
}, { path: '/' });
def('plan-groups', async () => {}, { path: '/plan?tab=groups' });
def('quickadd-group-suggestion', async (page) => {
    await page.click('button[aria-label="Add receipt"]');
    await page.waitForTimeout(500);
    for (const k of ['4', '9', ',', '9', '0']) await page.locator('[data-testid="keypad"] button', { hasText: new RegExp(`^${k}$`) }).first().click();
    await page.fill('#qa-merchant', 'Klarna');
    await page.waitForTimeout(300);
}, { path: '/' });

export { def };
export async function run(names = Object.keys(shots), data = pass3, extra = async () => {}) {
    const browser = await launch();
    for (const name of names) {
        const s = shots[name];
        if (!s) throw new Error(`unknown shot ${name}`);
        for (const scheme of ['light', 'dark']) {
            for (const width of s.wide ? [390, 1280] : [390]) {
                const { ctx, page } = await openApp(browser, { scheme, data, path: s.path, width, height: width === 390 ? 844 : 800 });
                if (s.auth) await ctx.addInitScript(TOKEN);
                await extra(ctx, page);
                await page.reload();
                await page.waitForTimeout(900);
                await s.fn(page, { width, scheme });
                await page.screenshot({ path: `${OUT}/${name}-${width === 390 ? '' : `${width}-`}${scheme}.png` });
                await ctx.close();
            }
        }
        console.log('shot', name);
    }
    await browser.close();
}

if (import.meta.url === `file://${process.argv[1]}`) await run(only.length ? only : undefined);
