// Pass 2: chat history screenshots (History sheet, a reopened evidence answer, desktop Insights).
// usage: npm run build && npx vite preview --port 4173 &  then  node scripts/screenshots/pass2-chat.mjs
import { launch, openApp, DEMO } from './lib.mjs';

const OUT = 'docs/screenshots/pass2';
const U = 'demo-user';
const TOKEN = () => localStorage.setItem('sb-your-project-id-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: 'demo-user' } }));
const narrative = { headline: 'Groceries are the story of this month', summary: 'Spending is led by groceries; most of it is explained by two supermarket trips.', wins: ['Dining is under its budget'], concerns: [], actions: [], questions: [], generatedAt: new Date().toISOString(), model: 'deepseek-flash', cached: false };
const TITLES = ['Where can I cut 100 €?', 'Am I on track for my goals?', 'What changed vs last month?', 'Top supermarket this cycle', 'Who owes me money?', 'Why was October higher?', 'Dining budget check', 'Subscriptions I forgot', 'Trip to Lisbon total', 'Fuel vs last year'];
const at = (i) => new Date(Date.now() - i * 36e5 * 7).toISOString();
const chatSeed = {
    chatConversations: Array.from({ length: 24 }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}`, userId: U, title: TITLES[i % TITLES.length], createdAt: at(i + 1), updatedAt: at(i), deletedAt: null })),
    chatMessages: Array.from({ length: 24 }, (_, i) => [
        { id: `m${i}a`, userId: U, conversationId: `c${String(i).padStart(2, '0')}`, role: 'user', content: TITLES[i % TITLES.length], meta: null, createdAt: at(i + 1), updatedAt: at(i + 1), deletedAt: null },
        { id: `m${i}b`, userId: U, conversationId: `c${String(i).padStart(2, '0')}`, role: 'assistant', content: 'Answer.', meta: null, createdAt: at(i + 0.5), updatedAt: at(i + 0.5), deletedAt: null },
    ]).flat(),
};
const data = { ...DEMO, ...chatSeed };

const browser = await launch();
const wire = async (ctx, page) => {
    await ctx.addInitScript(TOKEN);
    await page.reload();
    await page.waitForTimeout(700);
    await page.route('**/api/insights', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(narrative) }));
    await page.route('**/api/chat', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: 'Groceries are 142 of the 150 spent at supermarkets so far; item detail covers part of it, the rest has no lines yet.', citations: ['F2', 'F3', 'F4'], uncertain: ['F3'], proposals: [], model: 'deepseek-flash' }) }));
};

for (const scheme of ['light', 'dark']) {
    // 1. History sheet open
    {
        const { ctx, page } = await openApp(browser, { scheme, data, path: '/insights', width: 390, height: 844 });
        await wire(ctx, page);
        await page.getByTestId('chat-history-button').click();
        await page.waitForSelector('[data-testid="chat-history-item"]');
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/chat-history-sheet-${scheme}.png` });
        await ctx.close();
    }
    // 2. Ask, close the page, reopen: the answer comes back from the history with its evidence
    {
        const { ctx, page } = await openApp(browser, { scheme, data: DEMO, path: '/insights', width: 390, height: 844 });
        await wire(ctx, page);
        await page.getByRole('button', { name: 'Where did grocery money go?' }).click();
        await page.waitForSelector('[data-testid="evidence"]');
        await page.waitForTimeout(600);
        await page.goto('about:blank');
        await page.goto('http://localhost:4173/insights');
        await page.waitForSelector('[data-testid="evidence"]');
        await page.click('[data-testid="evidence-toggle"]');
        await page.waitForTimeout(600);
        await page.evaluate(() => document.querySelector('[data-testid="evidence"]').scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${OUT}/chat-reopened-answer-${scheme}.png` });
        await ctx.close();
    }
    // 3. Desktop
    {
        const { ctx, page } = await openApp(browser, { scheme, data, path: '/insights', width: 1280, height: 800 });
        await wire(ctx, page);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/chat-insights-1280-${scheme}.png` });
        if (scheme === 'light') {
            await page.getByTestId('chat-history-button').click();
            await page.waitForSelector('[data-testid="chat-history-item"]');
            await page.waitForTimeout(400);
            await page.screenshot({ path: `${OUT}/chat-history-sheet-1280-${scheme}.png` });
        }
        await ctx.close();
        const t = await openApp(browser, { scheme, data, path: '/insights', width: 820, height: 1180 });
        await wire(t.ctx, t.page);
        await t.page.getByTestId('chat-history-button').click();
        await t.page.waitForSelector('[data-testid="chat-history-item"]');
        await t.page.waitForTimeout(400);
        await t.page.screenshot({ path: `${OUT}/chat-history-sheet-820-${scheme}.png` });
        await t.ctx.close();
    }
}
await browser.close();
