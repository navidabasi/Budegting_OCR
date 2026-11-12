// Assistant v2 screenshots: "Your patterns" on Insights, an explain answer with general tips and an app_help answer.
// usage: npm run build && npx vite preview --port 4173 &   then   node scripts/screenshots/assistant-v2.mjs [name ...]
// Synthetic data only (pass3-data.mjs). /api/chat and /api/insights are answered here from the request itself: nothing is sent anywhere.
import fs from 'node:fs';
import { launch, openApp } from './lib.mjs';
import { pass3 } from './pass3-data.mjs';

const OUT = 'docs/screenshots/assistant-v2';
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const TOKEN = () => localStorage.setItem('sb-your-project-id-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: 'demo-user' } }));
const eur = (n) => `€${Number(n).toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

const chatAnswer = (body) => {
    const ev = body.evidence;
    const facts = ev.facts || [];
    if (ev.intent === 'app_help') {
        const f = facts.find((x) => x.kind === 'app_feature');
        return { answer: f ? `You find it on ${f.screen[0].toUpperCase()}${f.screen.slice(1)}:\n1. ${f.steps}` : 'Here are the app screens.', citations: f ? [f.id] : [], suggestedAction: f ? { type: 'open_screen', payload: { path: f.path } } : null, model: 'deepseek-chat' };
    }
    if (ev.intent === 'explain') {
        const cat = facts.find((x) => x.kind === 'category_total' && x.sharePct != null);
        const absent = facts.find((x) => x.kind === 'budget_absent');
        return {
            answer: [
                'A budget is a plan for each period’s money: you decide in advance how much goes where, and the app tells you how it is going.',
                cat ? `${cat.category} costs you ${eur(cat.amount)} this period, ${cat.sharePct}% of your spending. Even a fixed cost gets a budget line: it makes the period predictable and shows when it creeps up.` : '',
                absent?.suggestion ? `You have no ${absent.category} budget yet; your last ${absent.basedOnMonths} months averaged ${eur(absent.suggestion)}.` : '',
            ].filter(Boolean).join(' '),
            citations: [cat?.id, absent?.id].filter(Boolean),
            generalTips: ['Set fixed costs first, then share out what is left.', 'Review fixed costs once a year: rent, insurance and plans change.'],
            suggestedAction: absent?.suggestion ? { type: 'set_budget', payload: { category: absent.category, amount: absent.suggestion } } : null,
            model: 'deepseek-chat',
        };
    }
    return { answer: 'Here is what your records show.', citations: facts.slice(0, 1).map((f) => f.id), model: 'deepseek-chat' };
};
const insightsAnswer = (body) => ({ v: 2, verdict: `${eur(body.aggregates.verdict?.spent || 0)} spent so far this period.`, summary: '', opportunities: [], wins: [], watchouts: [], questions: [], generalTips: ['Move savings on payday, before spending starts.'], generatedAt: new Date().toISOString(), model: 'deepseek-chat', cached: false });

const wire = async (ctx, page) => {
    await ctx.addInitScript(TOKEN);
    await page.route('**/api/insights', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(insightsAnswer(JSON.parse(r.request().postData()))) }));
    await page.route('**/api/chat', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(chatAnswer(JSON.parse(r.request().postData()))) }));
    await page.reload();
    await page.waitForSelector('[data-testid="ways-to-save"]', { timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.addStyleTag({ content: '[class*="toast" i]{display:none!important}' });
};
const ask = async (page, q) => {
    await page.fill('[data-testid="chat-bar"] input', q);
    await page.click('[data-testid="chat-bar"] button[type="submit"]');
    await page.waitForSelector('[data-testid="evidence"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        const ev = document.querySelector('[data-testid="evidence"]');
        const bubble = ev.parentElement.querySelector('p');
        const pane = document.querySelector('[data-testid="chat-scroll"]');
        if (getComputedStyle(pane).overflowY === 'auto') pane.scrollTop += bubble.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12;
        else window.scrollTo(0, bubble.getBoundingClientRect().top + window.scrollY - 120);
    });
    await page.waitForTimeout(400);
};

const shots = {
    'insights-patterns': { fn: async (page) => {
        await page.evaluate(() => document.querySelector('[data-testid="your-patterns"]')?.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -16));
        await page.waitForTimeout(300);
    } },
    'chat-explain': { fn: (page) => ask(page, 'Why do I need to set a budget for housing?') },
    'chat-app-help': { fn: (page) => ask(page, 'Where do I find my subscriptions?') },
};

const browser = await launch();
for (const name of only.length ? only : Object.keys(shots)) {
    for (const scheme of ['light', 'dark']) {
        for (const width of [390, 1280]) {
            const { ctx, page } = await openApp(browser, { scheme, data: pass3, path: '/insights', width, height: width === 390 ? 844 : 900 });
            await wire(ctx, page);
            await shots[name].fn(page);
            await page.screenshot({ path: `${OUT}/${name}-${width === 390 ? '' : `${width}-`}${scheme}.png` });
            console.log('shot', name, scheme, width, await page.locator('[data-testid="pattern"]').count(), 'patterns');
            await ctx.close();
        }
    }
}
await browser.close();
