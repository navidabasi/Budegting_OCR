// Playwright helpers: signed-in demo state with a seeded IndexedDB mirror (no Supabase needed).
// usage (from a script): const { shot } = await session(); await shot('/activity', 'activity', {...})
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const BASE = process.env.BASE_URL || 'http://localhost:4173';
const pad = (n) => String(n).padStart(2, '0');
export const day = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const now = new Date().toISOString();
const U = 'demo-user';
const tx = (id, merchant, total, category, off, extra = {}) => ({
    id, userId: U, merchant, total, currency: 'EUR', category, date: day(off), notes: '', lineItems: [], isDemo: false, isPinned: false,
    transactionType: 'expense', groupId: null, groupName: null, groupTags: [], splitData: null, recurringData: null, trackingData: null,
    createdAt: now, updatedAt: now, ...extra,
});
export const DEMO = {
    settings: [{ userId: U, defaultCurrency: 'EUR', languageCode: 'en', ocrApiKey: null, notificationPreferences: { enabled: false, configuredAt: now, lastSetupPromptAt: now }, updatedAt: now }],
    accounts: [
        { id: 'a1', userId: U, name: 'Revolut', kind: 'spending', currency: 'EUR', openingBalance: 500, isArchived: false, sortOrder: 0, createdAt: now, updatedAt: now },
        { id: 'a2', userId: U, name: 'Cash', kind: 'cash', currency: 'EUR', openingBalance: 60, isArchived: false, sortOrder: 1, createdAt: now, updatedAt: now },
        { id: 'a3', userId: U, name: 'PostePay', kind: 'spending', currency: 'EUR', openingBalance: 120, isArchived: false, sortOrder: 2, createdAt: now, updatedAt: now },
        { id: 'a4', userId: U, name: 'Savings account', kind: 'savings', currency: 'EUR', openingBalance: 2000, isArchived: false, sortOrder: 3, createdAt: now, updatedAt: now },
    ],
    groups: [{ id: 'g1', userId: U, name: 'Household', color: '#3b82f6', isPinned: false, isDemo: false, parentGroupId: null, createdAt: now, updatedAt: now }],
    transactions: [
        tx('t1', 'Bar Roma', 4.72, 'Restaurant', 0, { accountId: 'a2' }),
        tx('t2', 'Lidl', 23.47, 'Groceries', 0, { accountId: 'a1', imagePath: 'demo/t2.jpg', groupId: 'g1', groupName: 'Household', groupTags: ['weekly shop'],
            lineItems: [{ name: 'Latte intero 1L', quantity: 1, price: 1.19 }, { name: 'Pane casereccio', quantity: 1, price: 2.49 }, { name: 'Banane 0,812 kg', quantity: 1, price: 1.29 }, { name: 'Uova M 10 pz', quantity: 1, price: 2.79 }, { name: 'Unreadable line', quantity: 1, price: 3.49 }] }),
        tx('t3', 'Lidl', 31.2, 'Groceries', 12, { accountId: 'a1' }),
        tx('t4', 'To Savings account', 400, 'Transfer', 1, { transactionType: 'transfer', accountId: 'a1', toAccountId: 'a4' }),
        tx('t5', 'Rent', 650, 'Utilities', 1, { accountId: 'a1', trackingData: { isTracked: true, status: 'open' } }),
        tx('t6', 'Q8 Torino Nord', 12.6, 'Other', 1, { accountId: 'a3' }),
        tx('t7', 'Conad City', 41.1, 'Groceries', 3, { accountId: 'a1' }),
        tx('t8', 'Trenitalia', 27.2, 'Transportation', 3, { accountId: 'a1' }),
        tx('t9', 'Salary', 2350, 'Income', 5, { transactionType: 'income', accountId: 'a1' }),
        tx('t10', 'Esselunga', 58.9, 'Groceries', 6, { accountId: 'a1' }),
    ],
};

export async function launch() {
    return chromium.launch();
}

/** Open a signed-in page with demo data seeded. opts: { scheme, lang, data } */
export async function openApp(browser, { scheme = 'light', lang = 'en', data = DEMO, path = '/', width = 390, height = 844 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme, serviceWorkers: 'block', locale: lang === 'en' ? 'en-GB' : lang });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.addInitScript(([state]) => {
        localStorage.setItem('receipt-manager-storage', JSON.stringify({ state, version: 0 }));
    }, [{ currentUser: { userId: U, email: 'demo@example.com' }, isAuthenticated: true, darkMode: scheme === 'dark', darkModeManual: scheme === 'dark', languageCode: lang }]);
    await page.goto(BASE + '/login'); // any route boots the app and creates the DB
    await page.waitForFunction(() => indexedDB.databases().then((d) => d.some((x) => x.name === 'wmw-data-v1')));
    await page.waitForTimeout(500);
    await page.evaluate(async (d) => {
        const open = () => new Promise((res, rej) => { const r = indexedDB.open('wmw-data-v1'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        const db = await open();
        for (const [store, rows] of Object.entries(d)) {
            if (!db.objectStoreNames.contains(store)) continue;
            await new Promise((res, rej) => {
                const t = db.transaction(store, 'readwrite');
                rows.forEach((r) => t.objectStore(store).put(r));
                t.oncomplete = res; t.onerror = () => rej(t.error);
            });
        }
        db.close();
    }, data);
    await page.goto(BASE + path);
    await page.waitForTimeout(900);
    return { ctx, page };
}

export const out = (name) => `docs/screenshots/${name}.png`;
