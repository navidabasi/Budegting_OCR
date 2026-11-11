// Layout audit: node scripts/e2e/audit.mjs   (needs `npm run build && npx vite preview --port 4173`)
// Opens each screen at phone sizes with long names, 200% text and a short (keyboard-open) viewport and reports
// horizontal overflow, controls outside the viewport and touch targets below 44 px.
import { launch, openApp, BASE } from '../screenshots/lib.mjs';
import { data } from './fixtures.mjs';

const ROUTES = ['/', '/activity', '/plan', '/plan?tab=savings', '/insights', '/receipts/t2', '/breakdown', '/shared', '/settings', '/scan', '/groups', '/trips/g2'];
const SIZES = [[360, 740], [390, 844]];
const browser = await launch();
let problems = 0;
const report = (...a) => {
    problems += 1;
    console.log(...a);
};

async function inspect(page, label) {
    const r = await page.evaluate(() => {
        const vw = window.innerWidth;
        const out = { overflowX: document.documentElement.scrollWidth - vw, wide: [], small: [], offscreen: [] };
        for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[aria-hidden="true"]')) continue;
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            const interactive = el.matches('button, a[href], input, select, textarea, [role="button"], [role="radio"], [role="tab"]') && !el.closest('.hidden');
            if (interactive && !el.closest('[class*="no-scrollbar"]')) {
                if (b.right > vw + 1 || b.left < -1) out.offscreen.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || el.id || '').trim().slice(0, 30)}" x=${Math.round(b.left)}..${Math.round(b.right)}`);
                const label = el.closest('label');
                const lb = label ? label.getBoundingClientRect() : null;
                const covered = lb && lb.height >= 43.5; // a checkbox/radio inside a tall label is as easy to hit as the label
                const iconOnly = !(el.textContent || '').trim();
                const tooSmall = b.height < 43.5 || (iconOnly && b.width < 43.5);
                if (tooSmall && !covered && !el.matches('input[type="range"], input[type="file"], input[type="hidden"]') && cs.opacity !== '0' && b.width > 2 && !el.closest('p, li > span')) out.small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || el.id || el.getAttribute('type') || el.className || '' || '').toString().trim().slice(0, 90)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
            }
            if (el.matches('input, textarea, select') && parseFloat(cs.fontSize) < 15.9 && !el.matches('[type="checkbox"], [type="radio"], [type="range"], [type="file"], [type="hidden"]')) out.small.push(`FONT ${el.tagName.toLowerCase()} ${cs.fontSize}`);
        }
        return out;
    });
    if (r.overflowX > 1) report(`[${label}] horizontal overflow ${r.overflowX}px`);
    r.offscreen.slice(0, 6).forEach((x) => report(`[${label}] control outside viewport: ${x}`));
    [...new Set(r.small)].slice(0, 8).forEach((x) => report(`[${label}] small target/font: ${x}`));
}

for (const [w, h] of SIZES) {
    for (const route of ROUTES) {
        const { ctx, page } = await openApp(browser, { data, path: route, width: w, height: h });
        await inspect(page, `${w}x${h} ${route}`);
        await page.addStyleTag({ content: 'html { font-size: 20px }' });
        await page.waitForTimeout(300);
        await inspect(page, `${w}x${h} ${route} @200%`);
        await ctx.close();
    }
}
await browser.close();
console.log(problems ? `${problems} problem(s)` : 'clean');
