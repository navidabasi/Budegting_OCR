// Brief case 13 (migrated records keep their relationships) and case 7 (foreign currency offline keeps the original, missing EUR is detectable).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));
vi.mock('../../services/exchangeRateService', () => ({ getRate: vi.fn(async () => null) }));
import { db, openDb } from '../db';
import { mappers } from '../api';
import { createRow, createTransaction, listRows, listTransactions, normalizeTransaction } from '../repo';
import { normalizeItems, reconcile } from '../../utils/receiptItems';
import { readSplit } from '../../utils/splits';
import { accountBalances, monthTotals, shareAmount } from '../../utils/money';
import { categoryBudgets, activeBudgets } from '../../utils/budgetMath';
import { cyclePeriod, cycleIdForDate } from '../../utils/payCycle';
import { needsBase } from '../../utils/baseAmount';
import { getEffectiveAmount } from '../../utils/helpers';
import { spendByCategory } from '../../utils/itemAnalysis';

const U = 'u1';
beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
});

describe('case 13: records written before pass 2 keep working and keep their relationships', () => {
    it('legacy items, splits, groups, accounts, goals, recurring data and photos survive the new readers unchanged', async () => {
        const acc = await createRow('accounts', U, { name: 'Revolut', kind: 'spending', currency: 'EUR', openingBalance: 500, openingDate: '2026-01-01' });
        const sav = await createRow('accounts', U, { name: 'Savings', kind: 'savings', currency: 'EUR', openingBalance: 0, openingDate: '2026-01-01' });
        const goal = await createRow('goals', U, { name: 'Trip', targetAmount: 1000, currency: 'EUR', startingAmount: 0 });
        const trip = await createRow('groups', U, { name: 'Lisbon', kind: 'trip', startsOn: '2026-11-01', endsOn: '2026-11-05', excludeFromBudgets: true, color: '#1F4E79' });
        const legacyItems = [{ name: 'Latte', quantity: 1, price: 1.19, category: 'Restaurant' }, { name: 'Pane', quantity: 2, price: 2.5, category: 'Groceries' }];
        const id = await createTransaction({
            userId: U, merchant: 'Lidl', total: 90, date: '2026-11-03', category: 'Groceries', accountId: acc.id, groupId: trip.id, groupName: 'Lisbon',
            imagePath: `${U}/x.jpg`, lineItems: legacyItems, splitData: { method: 'equal', people: 3 },
            recurringData: { isActive: true, frequency: 'monthly', nextDueDate: '2026-12-03' },
        });
        await createTransaction({ userId: U, transactionType: 'transfer', merchant: 'To savings', total: 100, date: '2026-11-04', accountId: acc.id, toAccountId: sav.id, goalId: goal.id });

        // the stored record is untouched by reading
        const [tx] = (await listTransactions(U)).filter((t) => t.id === id);
        expect(tx).toMatchObject({ groupId: trip.id, accountId: acc.id, imagePath: `${U}/x.jpg`, recurringData: { frequency: 'monthly' }, splitData: { method: 'equal', people: 3 } });
        expect(tx.lineItems).toHaveLength(2);
        expect(tx.lineItems[0].price).toBe(1.19); // legacy field intact; v14 category rename is read-side only
        // mappers round trip the legacy jsonb unchanged
        const row = mappers.transactions.toRow(tx);
        expect(row.line_items).toEqual(tx.lineItems);
        expect(row.split_data).toEqual({ method: 'equal', people: 3 });
        expect(mappers.transactions.fromRow({ ...row, id: id }).splitData).toEqual({ method: 'equal', people: 3 });

        // new readers
        expect(normalizeItems(tx.lineItems, tx.category).map((i) => [i.name, i.amount, i.category])).toEqual([['Latte', 1.19, 'Dining'], ['Pane', 2.5, 'Groceries']]);
        expect(reconcile(tx)).toMatchObject({ status: 'shortfall', total: 90 });
        expect(readSplit(tx.splitData, tx.total).shares).toEqual({ me: 3000, p2: 3000, p3: 3000 });
        expect(getEffectiveAmount(tx)).toBe(30);
        expect(shareAmount(tx)).toBe(30);
        // totals: spending is my share, the transfer to savings is saved, not spent; the balance moved by the full amount I paid
        const all = await listTransactions(U);
        expect(monthTotals(all, '2026-11', { trips: [trip], accounts: [acc, sav] })).toMatchObject({ spent: 30, saved: 100, travel: 30 });
        expect(accountBalances([acc, sav], all).map((b) => b.balance)).toEqual([500 - 90 - 100, 100]);
        expect(spendByCategory(all, '2026-11').reduce((s, c) => s + c.total, 0)).toBeCloseTo(30, 2);
    });

    it('budgets saved for calendar months keep applying to pay cycles that start after them', async () => {
        const budgets = [
            { id: 'b0', category: '*', amount: 2000, currency: 'EUR', startsOn: '2026-10-01', endsOn: null },
            { id: 'b1', category: 'Groceries', amount: 300, currency: 'EUR', startsOn: '2026-11-01', endsOn: null },
        ];
        const cfg = { rules: [{ from: '0000-01', payday: 12, weekendRule: 'none' }] };
        const cycle = cyclePeriod(cycleIdForDate('2026-11-12', cfg), cfg); // starts 12 Nov
        expect(activeBudgets(budgets, cycle).map((b) => b.id).sort()).toEqual(['b0', 'b1']);
        const rows = categoryBudgets(budgets, [{ id: 'x', transactionType: 'expense', merchant: 'Lidl', total: 40, currency: 'EUR', category: 'Groceries', date: '2026-11-20' }, { id: 'y', transactionType: 'expense', merchant: 'Lidl', total: 99, currency: 'EUR', category: 'Groceries', date: '2026-11-05' }], cycle, [], { today: new Date(2026, 10, 25) });
        expect(rows.find((r) => r.category === 'Groceries')).toMatchObject({ spent: 40, amount: 300 }); // the 5 Nov purchase belongs to the previous cycle
        expect(await listRows('budgets', U)).toEqual([]);
    });
});

describe('case 7: foreign currency saved offline', () => {
    it('keeps the original amount and currency, leaves the EUR amount empty (never 1:1) and can be detected', async () => {
        const id = await createTransaction({ userId: U, merchant: 'Cafe', total: 12.5, currency: 'USD', date: '2026-11-03', category: 'Dining' });
        const tx = normalizeTransaction((await listTransactions(U)).find((t) => t.id === id));
        expect(tx).toMatchObject({ total: 12.5, currency: 'USD' });
        expect(tx.amountBase ?? null).toBeNull();
        expect(needsBase(tx, 'EUR')).toBe(true);
        expect(await db.outbox.count()).toBe(1); // queued, not lost
    });
});
