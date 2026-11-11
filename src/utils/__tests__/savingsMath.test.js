import { describe, it, expect } from 'vitest';
import { goalMonthlyPace, goalStatus, savingsOverview } from '../savingsMath';
import { displayBalance, netWorth } from '../money';

const accounts = [
    { id: 'chk', kind: 'spending' },
    { id: 'sav', kind: 'savings' },
];
const tr = (date, total, extra = {}) => ({ id: date + total, date, total, transactionType: 'transfer', accountId: 'chk', toAccountId: 'sav', ...extra });
const inc = (date, total) => ({ id: `i${date}`, date, total, transactionType: 'income', accountId: 'chk' });

describe('savingsOverview', () => {
    it('computes the month, the 3-month average and rates', () => {
        const txs = [inc('2026-08-01', 2000), tr('2026-08-02', 300), inc('2026-09-01', 2000), tr('2026-09-02', 400), inc('2026-11-01', 2400), tr('2026-11-03', 400)];
        const o = savingsOverview(txs, '2026-11', { accounts });
        expect(o.saved).toBe(400);
        expect(o.savingsRate).toBeCloseTo(0.17, 2);
        expect(o.avgSaved).toBe(350);
        expect(o.avgRate).toBe(0.18);
        expect(o.months).toBe(2);
    });
    it('has no average without history', () => {
        expect(savingsOverview([inc('2026-11-01', 100)], '2026-11', { accounts }).avgSaved).toBeNull();
    });
});

describe('goals', () => {
    const goal = { id: 'g', targetAmount: 3000, targetDate: '2027-07-01' };
    it('pace is the monthly average of tagged transfers', () => {
        const txs = [tr('2026-09-05', 300, { goalId: 'g' }), tr('2026-10-05', 300, { goalId: 'g' }), tr('2026-11-05', 300, { goalId: 'g' }), tr('2026-11-06', 50)];
        expect(goalMonthlyPace(goal, txs, '2026-11')).toBe(300);
        expect(goalMonthlyPace(goal, [], '2026-11')).toBe(0);
    });
    it('status: months to target and needed per month', () => {
        const s = goalStatus({ goal, saved: 900, pace: 300, month: '2026-11' });
        expect(s.remaining).toBe(2100);
        expect(s.monthsToTarget).toBe(7);
        expect(s.reachedMonth).toBe('2027-06');
        expect(s.neededPerMonth).toBe(262.5);
        expect(s.pct).toBe(30);
    });
    it('status: no pace, done, past date', () => {
        expect(goalStatus({ goal, saved: 0, pace: 0, month: '2026-11' }).monthsToTarget).toBeNull();
        expect(goalStatus({ goal, saved: 3000, pace: 0, month: '2026-11' })).toMatchObject({ done: true, monthsToTarget: 0, neededPerMonth: null });
        expect(goalStatus({ goal, saved: 10, pace: 5, month: '2027-08' }).neededPerMonth).toBeNull();
    });
});

describe('net worth', () => {
    const balances = [
        { kind: 'spending', balance: 100, currency: 'EUR' },
        { kind: 'savings', balance: 900, currency: 'EUR' },
        { kind: 'debt', balance: 300, currency: 'EUR' },
        { kind: 'receivable', balance: -50, currency: 'EUR' },
    ];
    it('shows debt negative and receivable positive, and nets them', () => {
        expect(displayBalance(balances[2])).toBe(-300);
        expect(displayBalance(balances[3])).toBe(50);
        expect(netWorth(balances)).toBe(750);
    });
});
