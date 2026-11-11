// Pass 2 screenshots (390x844, light + dark) with synthetic data: node scripts/screenshots/pass2.mjs (needs `vite preview` on :4173)
import { launch, openApp, DEMO, day } from './lib.mjs';
const U = 'demo-user';
const now = new Date().toISOString();
const line = (id, name, amount, category, subcategory, extra = {}) => ({ v: 2, id, name, price: amount, amount, quantity: 1, category, subcategory, reviewStatus: 'confirmed', userEdited: [], ...extra });
const me = { id: 'me', name: 'Me' };
const marta = { id: 'marta', name: 'Marta' };
const split = { v: 2, payer: 'me', participants: [me, marta], method: 'equal', shares: { me: 1925, marta: 1925 } };
const tx = (id, merchant, total, category, off, extra = {}) => ({ id, userId: U, merchant, total, currency: 'EUR', category, date: day(off), notes: '', lineItems: [], isDemo: false, isPinned: false, transactionType: 'expense', groupId: null, groupName: null, groupTags: [], splitData: null, recurringData: null, trackingData: null, createdAt: now, updatedAt: now, ...extra });
const transactions = DEMO.transactions.map((t) => (t.id === 't2' ? { ...t, total: 62.4, lineItems: [
    line('i1', 'Latte intero 1L', 1.19, 'Groceries', 'dairy', { rawText: 'LATTE INT 1L' }), line('i2', 'Banane 0,812 kg', 1.29, 'Groceries', 'produce', { unit: 'kg', quantity: 0.812, unitPrice: 1.59 }),
    line('i3', 'Pasta', 2.4, 'Groceries', 'pantry'), line('i4', 'Pile AA', 8.9, 'Shopping'), line('i5', 'Shampoo', 6.5, 'Personal care'),
    { ...line('i6', '???', null, 'Groceries', null), amount: null, price: null, reviewStatus: 'needs_review' }] } : t))
    .concat([
        tx('s1', 'Pizzeria Da Mario', 38.5, 'Dining', 1, { accountId: 'a1', splitData: split }),
        tx('s2', 'Conad', 41.1, 'Groceries', 4, { accountId: 'a1', lineItems: [line('c1', 'Latte intero 1L', 1.2, 'Groceries', 'dairy'), line('c2', 'Mele', 3.1, 'Groceries', 'produce')] }),
        tx('s3', 'Lidl', 28.2, 'Groceries', 8, { accountId: 'a1', lineItems: [line('d1', 'Latte intero 1L', 1.25, 'Groceries', 'dairy')] }),
        tx('s4', 'Receipt to read', 0, 'Other', 0, { accountId: 'a1', imagePath: 'demo-user/s4.jpg', extraction: { pending: true } }),
    ]);
const data = {
    ...DEMO, transactions,
    layouts: [{ userId: U, layout: { prefs: { people: [marta], payCycle: { timezone: 'Europe/Rome', rules: [{ from: '0000-01', payday: 12, weekendRule: 'previous' }], overrides: [] } } }, updatedAt: now }],
    outbox: [{ seq: 1, table: 'transactions', op: 'insert', recordId: 's4', userId: U, payload: {}, ts: now, opId: 'op1', tries: 0, status: 'pending', lastError: null }, { seq: 2, table: 'transactions', op: 'update', recordId: 't3', userId: U, payload: {}, ts: now, opId: 'op2', tries: 2, status: 'failed', lastError: 'new row violates row-level security policy' }],
    drafts: [{ id: `${U}:quickadd`, userId: U, kind: 'quickadd', data: { state: { type: 'expense', expr: '12.5', merchant: 'Bar Roma', category: '', categoryTouched: false, date: day(0), accountId: 'a1', toAccountId: null, goalId: null, tripDetached: false, more: { items: [], notes: '', groupId: null, groupName: null, tags: [], splitData: null, recurringData: null, planned: false, currency: 'EUR' }, showMore: false, showAllCategories: false }, txId: 'draft-1' }, updatedAt: Date.now() }],
};
const browser = await launch();
const shot = async (page, name, scheme) => page.screenshot({ path: `docs/screenshots/pass2/${name}-${scheme}.png` });
for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await openApp(browser, { scheme, data, path: '/' });
    const go = async (p, wait = 900) => { await page.goto((process.env.BASE_URL || 'http://localhost:4173') + p); await page.waitForTimeout(wait); };
    await shot(page, 'home', scheme);
    await page.click('[data-testid="period-label"]').catch(() => {}); await page.waitForTimeout(500);
    await shot(page, 'period-picker', scheme);
    await go('/activity'); await shot(page, 'activity', scheme);
    await go('/activity'); await page.click('[data-testid="sync-chip"]').catch(() => {}); await page.waitForTimeout(500); await shot(page, 'sync-needs-attention', scheme);
    await go('/receipts/t2', 1200); await shot(page, 'detail-items', scheme);
    await go('/receipts/s4', 1200); await shot(page, 'detail-pending-total', scheme);
    await go('/breakdown', 1200); await shot(page, 'breakdown', scheme);
    await go('/shared', 1200); await shot(page, 'shared', scheme);
    await page.click('[data-testid="person-row"]').catch(() => {}); await page.waitForTimeout(500); await shot(page, 'shared-person', scheme);
    await go('/'); await page.click('button[aria-label="Add receipt"], nav button:has(svg.lucide-plus)').catch(() => {}); await page.waitForTimeout(800); await shot(page, 'quickadd-draft', scheme);
    await ctx.close();
}
await browser.close();
