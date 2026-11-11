// Pass 3 synthetic data (never real history): the owner's group names and custom categories, tags, splits and five months of
// history so the savings opportunities have something to find (weekly supermarkets, a tobacconist habit, Klarna instalments, rent,
// subscriptions with a price rise, an unbudgeted volatile category, uncategorised spending).
import { DEMO, day } from './lib.mjs';

const U = 'demo-user';
const now = new Date().toISOString();
const tx = (id, merchant, total, category, off, extra = {}) => ({
    id, userId: U, merchant, total, currency: 'EUR', category, date: day(off), notes: '', lineItems: [], isDemo: false, isPinned: false,
    transactionType: 'expense', groupId: null, groupName: null, groupTags: [], splitData: null, recurringData: null, trackingData: null,
    accountId: 'a1', createdAt: now, updatedAt: now, ...extra,
});
const G = (id, name, color, extra = {}) => ({ id, userId: U, name, color, isPinned: false, isDemo: false, parentGroupId: null, createdAt: now, updatedAt: now, ...extra });

export const GROUPS = [
    G('g-debts', 'Debts', '#ef4444', { isPinned: true }),
    G('g-subs', 'Subscriptions', '#8b5cf6'),
    G('g-income', 'Income', '#10b981'),
    G('g-gifts', 'Birthday gifts', '#f59e0b'),
    G('g-lends', 'Lends', '#3b82f6'),
    DEMO.groups.find((g) => g.kind === 'trip'),
];
const inGroup = (id) => {
    const g = GROUPS.find((x) => x.id === id);
    return { groupId: g.id, groupName: g.name };
};
const split = (total) => {
    const c = Math.round(total * 100);
    return { v: 2, payer: 'me', participants: [{ id: 'me', name: 'Me' }, { id: 'marta', name: 'Marta' }], method: 'equal', shares: { me: Math.ceil(c / 2), marta: Math.floor(c / 2) } };
};

const rows = [];
let n = 0;
const add = (...a) => rows.push(tx(`p3-${++n}`, ...a));
// 150 days of history, newest first by offset
for (let w = 0; w < 21; w++) {
    const base = w * 7;
    add('Lidl', 38 + ((w * 7) % 13) + 0.45, 'Groceries', base + 1, w === 0 ? { imagePath: 'demo/l.jpg', lineItems: [{ v: 2, id: 'i1', name: 'Latte intero 1L', amount: 1.19, price: 1.19, quantity: 1, category: 'Groceries', subcategory: 'dairy', reviewStatus: 'confirmed', userEdited: [] }, { v: 2, id: 'i2', name: 'Pane casereccio', amount: 2.49, price: 2.49, quantity: 1, category: 'Groceries', subcategory: 'bakery', reviewStatus: 'needs_review', userEdited: [] }] } : {});
    add('Conad', 52 + ((w * 11) % 17) + 0.2, 'Groceries', base + 4);
    if (w % 2 === 0) add('Eurospin', 24 + ((w * 5) % 9) + 0.6, 'Groceries', base + 5);
    // tobacconist habit: rising in the current period
    for (let k = 0; k < (w < 3 ? 4 : 2); k++) add('Tabaccheria Centrale', 5.5, 'Other', base + k + 2, { accountId: 'a2' });
    add('Bar Roma', 3.2 + (w % 3), 'Dining', base + 3, { accountId: 'a2' });
    if (w % 3 === 0) add('Pizzeria Da Mario', 38.5, 'Dining', base + 6, { splitData: split(38.5), groupTags: ['friends'] });
}
for (let m = 0; m < 5; m++) {
    const off = m * 30;
    add('Salary', 2350, 'Income', off + 10, { transactionType: 'income', ...inGroup('g-income') });
    add('Rent', 650, 'Housing', off + 9, { recurringData: { frequency: 'monthly' } });
    add('Enel Energia', 58 + m * 3, 'Utilities', off + 14);
    add('Netflix', m < 2 ? 15.99 : 12.99, 'Subscriptions', off + 12, { ...inGroup('g-subs') });
    add('Spotify', 11.99, 'Subscriptions', off + 15, { ...inGroup('g-subs') });
    add('Klarna', 49.9, 'Debt', off + 7, { ...inGroup('g-debts'), groupTags: ['bnpl'] });
    add('Amazon', [23.9, 64.5, 18.2, 121.4, 41][m], 'Shopping', off + 18);
    add('Q8 Torino Nord', [12.6, 45, 30.2, 8.8, 52][m], 'Other', off + 20, { accountId: 'a3' });
    add('Allianz', 32.4, 'Insurance', off + 22);
}
add('Marco', 50, 'Debt', 25, { ...inGroup('g-debts'), notes: 'paid back half' });
add('Luca', 80, 'Transfer', 40, { transactionType: 'transfer', toAccountId: 'a2', ...inGroup('g-lends') });
add('Libreria Feltrinelli', 24.9, 'Gift', 16, { ...inGroup('g-gifts'), groupTags: ['birthday'] });
add('Pandora', 59, 'Gift', 70, { ...inGroup('g-gifts'), groupTags: ['birthday'] });
add('Cinema Massimo', 18, 'Date', 9, { splitData: split(18) });
add('Directa', 200, 'Stocks', 33, { transactionType: 'transfer', toAccountId: 'a4' });

export const CATEGORIES = ['Date', 'Debt', 'Gift', 'Stocks'].map((name, i) => ({ id: `cat${i}`, userId: U, name, color: ['#ec4899', '#ef4444', '#f59e0b', '#14b8a6'][i], createdAt: now, updatedAt: now }));

export const pass3 = {
    ...DEMO,
    groups: GROUPS,
    categories: CATEGORIES,
    transactions: [...DEMO.transactions.filter((t) => ['t2', 't11', 't12', 't13', 't14'].includes(t.id)).map((t) => (t.id === 't2' ? { ...t, groupId: null, groupName: null } : t)), ...rows],
};
