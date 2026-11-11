// Synthetic data for the layout checks (never real history). Long merchant names, items, a split, a foreign pending record.
import { DEMO, day } from '../screenshots/lib.mjs';
const U = 'demo-user';
const now = new Date().toISOString();
const line = (id, name, amount, category, subcategory, extra = {}) => ({ v: 2, id, name, price: amount, amount, quantity: 1, category, subcategory, reviewStatus: 'confirmed', userEdited: [], ...extra });
const tx = (id, merchant, total, category, off, extra = {}) => ({ id, userId: U, merchant, total, currency: 'EUR', category, date: day(off), notes: '', lineItems: [], isDemo: false, isPinned: false, transactionType: 'expense', groupId: null, groupName: null, groupTags: [], splitData: null, recurringData: null, trackingData: null, createdAt: now, updatedAt: now, ...extra });
export const LONG = 'Supermercato Alimentari Fratelli Rossi e Figli S.R.L. di Torino Centro';
const many = Array.from({ length: 40 }, (_, i) => tx(`m${i}`, i % 4 === 0 ? `${LONG} ${i}` : ['Lidl', 'Conad', 'Esselunga', 'Bar Roma', 'Q8'][i % 5], 5 + ((i * 7) % 60) + 0.35, ['Groceries', 'Dining', 'Transport', 'Other'][i % 4], i % 25, { accountId: 'a1' }));
export const data = {
    ...DEMO,
    transactions: [
        ...DEMO.transactions.map((t) => (t.id === 't2' ? { ...t, merchant: LONG, total: 62.4, lineItems: [line('i1', 'Latte intero parzialmente scremato a lunga conservazione 1L', 1.19, 'Groceries', 'dairy'), line('i2', 'Banane 0,812 kg', 1.29, 'Groceries', 'produce', { unit: 'kg', quantity: 0.812 }), line('i3', 'Pile AA', 8.9, 'Shopping')] } : t)),
        ...many,
        tx('fx1', 'Cafe Lisboa', 50, 'Dining', 1, { currency: 'USD', amountBase: null, accountId: 'a1' }),
    ],
};
