// Synthetic data shaped like the owner's record (never real history): about 258 transactions from Dec 2025 to mid Nov 2026, EUR,
// mostly Lidl / Conad / Eurospin groceries, Klarna and friend debts, rent 380, a few subscriptions (one with a price rise),
// "Other" as the largest expense category, custom categories Date / Debt / Gift / Stocks, the owner's groups, a split dinner now and
// then, and only a handful of receipts with line items. Deterministic: no clock, no randomness.
// Used by the unit tests, the contract tests and scripts/live/insights-check.mjs.
const pad = (n) => String(n).padStart(2, '0');
const U = 'synthetic-user';

export const TODAY = '2026-11-12';
export const PAY_CYCLE = { timezone: 'Europe/Rome', rules: [{ from: '0000-01', payday: 27, weekendRule: 'none' }], overrides: [] };
export const GROUPS = [
    { id: 'g-debts', name: 'Debts' },
    { id: 'g-subs', name: 'Subscriptions' },
    { id: 'g-income', name: 'Income' },
    { id: 'g-gifts', name: 'Birthday gifts' },
    { id: 'g-lends', name: 'Lends' },
];
export const ACCOUNTS = [
    { id: 'a-main', name: 'Main account', kind: 'spending', currency: 'EUR', openingBalance: 300 },
    { id: 'a-cash', name: 'Cash', kind: 'cash', currency: 'EUR', openingBalance: 40 },
    { id: 'a-save', name: 'Savings', kind: 'savings', currency: 'EUR', openingBalance: 500 },
];
export const GOALS = [{ id: 'goal-1', name: 'Emergency fund', targetAmount: 2000, currency: 'EUR', targetDate: null, accountId: null, startingAmount: 400, isArchived: false }];
export const BUDGETS = [{ id: 'b-groceries', category: 'Groceries', amount: 260, currency: 'EUR', startsOn: '2025-12-01', endsOn: null }];
export const CATEGORY_NAMES = ['Groceries', 'Dining', 'Transport', 'Fuel', 'Housing', 'Utilities', 'Subscriptions', 'Shopping', 'Health', 'Entertainment', 'Insurance', 'Other', 'Date', 'Debt', 'Gift', 'Stocks'];

const group = (id) => ({ groupId: id, groupName: GROUPS.find((g) => g.id === id).name });
const split = (total) => {
    const c = Math.round(total * 100);
    return { v: 2, payer: 'me', participants: [{ id: 'me', name: 'Me' }, { id: 'p1', name: 'Friend' }], method: 'equal', shares: { me: Math.ceil(c / 2), p1: Math.floor(c / 2) } };
};

export function ownerLikeTransactions() {
    const out = [];
    let n = 0;
    const add = (date, merchant, total, category, extra = {}) =>
        out.push({ id: `s${++n}`, userId: U, merchant, total, currency: 'EUR', category, date, notes: '', lineItems: [], transactionType: 'expense', groupId: null, groupName: null, groupTags: [], splitData: null, recurringData: null, trackingData: null, accountId: 'a-main', createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z`, ...extra });
    const months = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
    months.forEach((m, i) => {
        const d = (day) => `${m}-${pad(day)}`;
        const last = m === '2026-11';
        const ok = (day) => !last || `${m}-${pad(day)}` <= TODAY;
        const put = (day, ...rest) => ok(day) && add(d(day), ...rest);
        // salary on the 27th starts the cycle; rent right after
        put(27, 'Stipendio', 1432, 'Income', { transactionType: 'income', ...group('g-income') });
        put(28, 'Affitto', 380, 'Housing');
        // groceries: Lidl weekly, Conad twice (bigger baskets), Eurospin once
        [2, 11, 23].forEach((day, k) => put(day, 'Lidl', 24 + ((i * 3 + k * 5) % 9) + 0.35, 'Groceries'));
        [5, 19].forEach((day, k) => put(day, 'Conad', 41 + ((i * 7 + k * 4) % 11) + 0.6, 'Groceries'));
        put(12, 'Eurospin', 19 + (i % 6) + 0.9, 'Groceries');
        // Other is the largest flexible category: tobacconist, cash machine, odd shops
        [2, 5, 9, 12, 23].forEach((day, k) => put(day, 'Tabaccheria Centrale', 5.5 + (k % 2), 'Other', { accountId: 'a-cash' }));
        put(8, 'Prelievo', 80, 'Other');
        if (i % 2 === 0) put(21, 'Amazon', 28 + ((i * 13) % 40), 'Other');
        put(3, 'Mercato', 22 + (i % 5) * 3, '');
        // subscriptions: Netflix rises in September, Spotify stays the same
        put(6, 'Netflix', i >= 9 ? 15.99 : 12.99, 'Subscriptions', group('g-subs'));
        put(11, 'Spotify', 11.99, 'Subscriptions', group('g-subs'));
        // debts: Klarna instalments, a friend paid back now and then
        put(7, 'Klarna', 39.9, 'Debt', group('g-debts'));
        if (i % 3 === 1) put(15, 'Marco', 50, 'Debt', group('g-debts'));
        // dining: quiet until autumn, then clearly above the earlier cycles
        const dining = i >= 10 ? [1, 4, 6, 8, 11] : [1, 4, 18];
        dining.forEach((day, k) => {
            const total = i >= 10 ? 16 + k * 3 : 11 + ((i + k) % 5);
            put(day, k % 2 ? 'Pizzeria Da Mario' : 'Bar Roma', total, 'Dining', k === 1 ? { splitData: split(total) } : {});
        });
        // utilities move every month (a bill, not a price rise)
        put(20, 'Enel Energia', 44 + ((i * 5) % 17), 'Utilities');
        // shopping swings a lot and has no budget
        put(22, 'Zara', [35, 110, 20, 85, 15, 140, 30, 95, 25, 120, 40, 60][i], 'Shopping');
        if (i % 4 === 0) put(13, 'Cinema Massimo', 18, 'Date', { splitData: split(18) });
        if (i % 5 === 2) put(25, 'Libreria Feltrinelli', 24.9, 'Gift', group('g-gifts'));
        if (i % 2 === 0) put(26, 'Directa', 50, 'Stocks');
        if (i % 6 === 3) put(18, 'Luca', 40, 'Transfer', { transactionType: 'transfer', toAccountId: 'a-cash', ...group('g-lends') });
        if (i % 2 === 1) put(29 > 28 && m === '2026-02' ? 28 : 29, 'Emergency fund', 60, 'Transfer', { transactionType: 'transfer', toAccountId: 'a-save', goalId: 'goal-1' });
    });
    // a refund recorded as income and a planned (unpaid) bill: neither is spending
    add('2026-11-03', 'Zara refund', 20, 'Income', { transactionType: 'income' });
    add('2026-11-20', 'Car insurance', 210, 'Insurance', { trackingData: { isTracked: true, status: 'open' } });
    // the few receipts with line items
    const items = (rows) => rows.map(([name, amount, quantity, unit], k) => ({ v: 2, id: `i${k}`, name, amount, price: amount, quantity, unit, category: 'Groceries', subcategory: 'dairy', reviewStatus: 'confirmed', userEdited: [] }));
    const lidl = out.filter((t) => t.merchant === 'Lidl').slice(-2);
    const conad = out.filter((t) => t.merchant === 'Conad').slice(-2);
    lidl.forEach((t) => (t.lineItems = items([['Latte intero', 1.09, 1, 'l'], ['Mozzarella', 5.4, 0.6, 'kg']])));
    conad.forEach((t) => (t.lineItems = items([['Latte intero', 1.49, 1, 'l'], ['Mozzarella', 7.8, 0.6, 'kg']])));
    return out;
}

/** Everything computeOpportunities / computeInsights / buildEvidencePack need, for the cycle that contains TODAY. */
export function ownerLike() {
    return { transactions: ownerLikeTransactions(), budgets: BUDGETS, goals: GOALS, accounts: ACCOUNTS, trips: [], groups: GROUPS, people: [], config: PAY_CYCLE, today: TODAY, currency: 'EUR', categoryNames: CATEGORY_NAMES };
}
