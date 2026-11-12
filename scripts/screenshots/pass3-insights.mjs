// Pass 3, workstream A screenshots: the Insights page, an opened "Why?", the Home teaser and a save_money chat answer.
// usage: npm run build && npx vite preview --port 4173 &   then   node scripts/screenshots/pass3-insights.mjs [name ...]
// Synthetic data only (pass3-data.mjs). The two AI endpoints are answered here from the figures in the request itself, the way the
// model is asked to: nothing is sent anywhere.
import fs from 'node:fs';
import { launch, openApp } from './lib.mjs';
import { pass3 } from './pass3-data.mjs';

const OUT = 'docs/screenshots/pass3';
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const TOKEN = () => localStorage.setItem('sb-your-project-id-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: 'demo-user' } }));
const eur = (n) => `€${Number(n).toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** A stand-in for the model: one sentence per opportunity, quoting only figures that are in the request. */
const explain = (o) => {
    switch (o.oppKind) {
        case 'category_above_baseline': return { explanation: `${o.category} is at ${eur(o.current)} so far against your usual ${eur(o.baseline)} at this point, ${eur(o.excess)} more.`, howTo: o.suggestedBudget ? `A ${o.category} budget of ${eur(o.suggestedBudget)} would keep it at your usual level.` : `The list shows the ${o.count} payments behind it.` };
        case 'merchant_frequency': return { explanation: `${o.count} visits to ${o.merchant} came to ${eur(o.total)}, about ${eur(o.average)} each time.`, howTo: `Skipping one visit a week adds up to ${eur(o.monthlySaving)} a month.` };
        case 'subscription_review': return { explanation: `${o.merchant} costs ${eur(o.amount)} a month, ${eur(o.yearly)} a year.`, howTo: 'Have a look at the charges and decide if you still use it.' };
        case 'price_creep': return { explanation: `${o.merchant} went from ${eur(o.from)} to ${eur(o.to)} a month, ${eur(o.yearlyIncrease)} more a year.`, howTo: 'Check whether a cheaper plan still covers what you watch.' };
        case 'cheaper_store': return o.basis === 'basket' ? { explanation: `Your average basket is ${eur(o.cheaperAverage)} at ${o.cheaper} and ${eur(o.pricierAverage)} at ${o.pricier}; this compares baskets, not prices.`, howTo: `Moving one shop a month would save about ${eur(o.monthlySaving)} if the basket stays the same.` } : { explanation: `The same products cost less per unit at ${o.cheaper} than at ${o.pricier}.`, howTo: `That is about ${eur(o.monthlySaving)} a month on what you buy there.` };
        case 'budget_gap': return { explanation: `${o.category} has no budget and moved between ${eur(o.lowest)} and ${eur(o.highest)} over your last ${o.periods} periods.`, howTo: `A budget of ${eur(o.suggestedBudget)} matches your usual level.` };
        case 'debt_cost': return { explanation: `${eur(o.amount)} went to repayments this period${o.incomePct !== null ? `, ${o.incomePct}% of your income` : ''}.`, howTo: 'This is a commitment rather than spending to cut; the list shows each payment.' };
        case 'goal_boost': return { explanation: `Putting ${eur(o.saving)} a month into ${o.goal} would get you there in ${o.monthsWith} months${o.monthsNow ? ` instead of ${o.monthsNow}` : ''}.`, howTo: 'Move the amount when the saving shows up.' };
        case 'uncategorised_blind_spot': return { explanation: `${eur(o.amount)} of this period's spending (${o.pct}%) has no category, in ${o.count} payments.`, howTo: 'Sorting them makes every other figure here more precise.' };
        default: return { explanation: `${o.merchant} is a fixed cost of ${eur(o.amount)} a month.`, howTo: 'Mark it recurring so it appears in your upcoming bills.' };
    }
};
const insightsAnswer = (body) => {
    const a = body.aggregates;
    const v = a.verdict || {};
    const win = (a.findings || []).find((f) => f.severity === 'positive');
    const watch = (a.findings || []).find((f) => f.severity === 'high' || f.severity === 'medium');
    const top = (a.opportunities || [])[0];
    return {
        v: 2,
        verdict: v.change > 0 ? `${eur(v.spent)} spent so far, ${eur(v.change)} more than at this point last period.` : `${eur(v.spent)} spent so far this period.`,
        summary: top ? `The biggest lever is ${top.category || top.merchant}: ${eur(top.monthlySaving)} a month.` : '',
        opportunities: (a.opportunities || []).map((o) => ({ id: o.id, ...explain(o) })),
        wins: win ? [{ text: win.title, ref: win.id }] : [],
        watchouts: watch ? [{ text: watch.title, ref: watch.id }] : [],
        questions: [],
        generatedAt: new Date().toISOString(),
        model: 'deepseek-chat',
        cached: false,
    };
};
const chatAnswer = (body) => {
    const facts = body.evidence?.facts || [];
    const opps = facts.filter((f) => f.kind === 'opportunity');
    const total = facts.find((f) => f.kind === 'saving_total');
    const lines = opps.slice(0, 3).map((o) => `• ${explain(o).explanation}`);
    return {
        answer: [`For ${body.evidence.period.start} to ${body.evidence.period.end}, in ${body.evidence.currency} on your own share:`, ...lines, total ? `Together that is about ${eur(total.monthly)} a month.` : ''].filter(Boolean).join('\n'),
        citations: [...opps.slice(0, 3).map((o) => o.id), ...(total ? [total.id] : [])],
        uncertain: [],
        proposals: [],
        suggestedAction: opps[0]?.action === 'set_budget' ? { type: 'set_budget', payload: { category: opps[0].category, amount: opps[0].suggestedBudget } } : null,
        model: 'deepseek-chat',
    };
};

const wire = async (ctx, page) => {
    await ctx.addInitScript(TOKEN);
    await page.route('**/api/insights', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(insightsAnswer(JSON.parse(r.request().postData()))) }));
    await page.route('**/api/chat', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(chatAnswer(JSON.parse(r.request().postData()))) }));
    await page.reload();
    await page.waitForSelector('[data-testid="opportunity"], [data-testid="save-teaser"]', { timeout: 15000 });
    await page.waitForTimeout(2200);
    await page.locator('[role="status"] button, [data-testid="toast"] button').first().click({ timeout: 300 }).catch(() => {});
    await page.addStyleTag({ content: '[class*="toast" i]{display:none!important}' });
};
const hideChat = (page) => page.addStyleTag({ content: '[data-testid="chat"] .fixed, nav.fixed, [data-testid="bottom-nav"]{display:none!important}' });

const shots = {
    // the page as it opens
    insights: { path: '/insights', wide: true, fn: async () => {} },
    // the centre of the page: the cards
    'insights-ways-to-save': { path: '/insights', wide: true, fn: async (page, { width }) => {
        if (width === 390) await page.evaluate(() => document.querySelector('[data-testid="ways-to-save"]').scrollIntoView({ block: 'start' }));
        else await page.evaluate(() => window.scrollTo(0, 420));
        await page.waitForTimeout(300);
    } },
    'insights-why': { path: '/insights', wide: true, fn: async (page) => {
        await page.locator('[data-testid="opportunity-why"]').first().click();
        await page.waitForTimeout(300);
        await page.evaluate(() => document.querySelector('[data-testid="opportunity"]').scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -12));
        await page.waitForTimeout(300);
    } },
    'insights-wins': { path: '/insights', fn: async (page) => {
        await page.evaluate(() => document.querySelector('[data-testid="wins"], [data-testid="watchouts"]')?.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(300);
    } },
    // the whole page in one image (the fixed chat bar is hidden so nothing is covered)
    'insights-full': { path: '/insights', wide: true, full: true, fn: async (page) => { await hideChat(page); } },
    'insights-offline-fallback': { path: '/insights', noAi: true, fn: async () => {} },
    'home-save-teaser': { path: '/', fn: async (page) => {
        await page.evaluate(() => document.querySelector('[data-testid="save-teaser"]').scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(300);
    } },
    'chat-save-money': { path: '/insights', wide: true, fn: async (page) => {
        await page.getByRole('button', { name: 'Where can I save?' }).click();
        await page.waitForSelector('[data-testid="evidence"]');
        await page.click('[data-testid="evidence-toggle"]');
        await page.waitForTimeout(500);
        await page.evaluate(() => document.querySelector('[data-testid="chat"] ol li:last-of-type')?.scrollIntoView({ block: 'end' }));
        await page.evaluate(() => { const ev = document.querySelector('[data-testid="evidence"]'); const top = ev.previousElementSibling || ev; window.scrollTo(0, top.getBoundingClientRect().top + window.scrollY - 150); });
        await page.waitForTimeout(400);
    } },
};

const browser = await launch();
for (const name of only.length ? only : Object.keys(shots)) {
    const s = shots[name];
    if (!s) throw new Error(`unknown shot ${name}`);
    for (const scheme of ['light', 'dark']) {
        for (const width of s.wide ? [390, 1280] : [390]) {
            const { ctx, page } = await openApp(browser, { scheme, data: pass3, path: s.path, width, height: width === 390 ? 844 : 900 });
            if (s.noAi) {
                await ctx.addInitScript(TOKEN);
                await page.route('**/api/insights', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'llm_not_configured' }) }));
                await page.reload();
                await page.waitForSelector('[data-testid="opportunity"]');
                await page.waitForTimeout(900);
            } else await wire(ctx, page);
            await s.fn(page, { width, scheme });
            await page.screenshot({ path: `${OUT}/${name}-${width === 390 ? '' : `${width}-`}${scheme}.png`, fullPage: !!s.full });
            await ctx.close();
        }
    }
    console.log('shot', name);
}
await browser.close();
