import { describe, it, expect } from 'vitest';
import { computeOpportunities, detectRecurringCharges, isDismissed, pruneDismissed, toModelOpportunities, toModelDismissed, totalMonthlySaving, OPPORTUNITY_KINDS, OPPORTUNITY_ACTIONS, DISMISS_DAYS } from '../savingsOpportunities';
import { spendClass } from '../../utils/spendClass';
import { ownerLike, TODAY } from '../__fixtures__/ownerLike';
import { currentCyclePeriod, normalizeConfig } from '../../utils/payCycle';

let n = 0;
const tx = (o) => ({ id: `t${++n}`, date: '2026-11-05', total: 10, currency: 'EUR', category: 'Dining', merchant: 'Some shop', transactionType: 'expense', lineItems: [], ...o });
const monthly = (merchant, amounts, o = {}, day = '04', first = 12 - amounts.length) => amounts.map((total, i) => tx({ merchant, total, date: `2026-${String(first + i).padStart(2, '0')}-${day}`, ...o }));
const run = (transactions, extra = {}) => computeOpportunities({ transactions, period: '2026-11', today: '2026-11-20', ...extra });
const of = (r, kind) => r.all.filter((o) => o.kind === kind);

describe('spend class', () => {
    it('rent, housing, utilities and insurance are fixed; Klarna and friend debts are debt; Stocks is savings', () => {
        expect(spendClass({ merchant: 'Rent', category: 'Housing' })).toBe('fixed');
        expect(spendClass({ merchant: 'Affitto', category: 'Other' })).toBe('fixed');
        expect(spendClass({ merchant: 'Enel Energia', category: 'Utilities' })).toBe('fixed');
        expect(spendClass({ merchant: 'Allianz', category: 'Insurance' })).toBe('fixed');
        expect(spendClass({ merchant: 'Klarna', category: 'Shopping' })).toBe('debt');
        expect(spendClass({ merchant: 'Marco', category: 'Debt' })).toBe('debt');
        expect(spendClass({ merchant: 'Marco', category: 'Other', groupName: 'Debts' })).toBe('debt');
        expect(spendClass({ merchant: 'Anna', category: 'Other', groupId: 'g', accountId: 'a' }, { groups: [{ id: 'g', name: 'Lends' }], accounts: [] })).toBe('debt');
        expect(spendClass({ merchant: 'Bank', category: 'Other', accountId: 'a' }, { accounts: [{ id: 'a', kind: 'debt' }] })).toBe('debt');
        expect(spendClass({ merchant: 'Directa', category: 'Stocks' })).toBe('savings');
        expect(spendClass({ merchant: 'Lidl', category: 'Groceries' })).toBe('flexible');
        expect(spendClass({ merchant: 'Netflix', category: 'Subscriptions' })).toBe('flexible');
    });
});

describe('subscription_review and fixed_cost', () => {
    it('a monthly charge at the same price is a subscription with its monthly and yearly cost', () => {
        const r = run(monthly('Spotify', [11.99, 11.99, 11.99, 11.99], { category: 'Subscriptions' }));
        const [o] = of(r, 'subscription_review');
        expect(o).toMatchObject({ merchant: 'spotify', monthlySaving: 11.99, yearlySaving: 143.88, level: 'medium', action: { type: 'review_subscription', merchant: 'spotify' } });
        expect(o.params).toMatchObject({ name: 'Spotify', amount: 11.99, yearly: 143.88, months: 4, unchangedMonths: 4 });
        expect(o.scope).toEqual({ start: '2026-08-04', end: '2026-11-20' });
        expect(o.evidence).toHaveLength(4);
    });
    it('rent is never a subscription: it is a fixed cost and the only suggestion is to mark it recurring', () => {
        const r = run(monthly('Rent', [380, 380, 380], { category: 'Housing' }));
        expect(of(r, 'subscription_review')).toHaveLength(0);
        const [o] = of(r, 'fixed_cost');
        expect(o).toMatchObject({ monthlySaving: 0, yearlySaving: 0, action: { type: 'mark_recurring', frequency: 'monthly' } });
        expect(o.params).toMatchObject({ name: 'Rent', amount: 380, months: 3 });
        expect(o.action.txId).toBe(r.all.find((x) => x.kind === 'fixed_cost').evidence.at(-1));
    });
    it('utilities, insurance and "Affitto" filed under Other are fixed costs too; nothing once they are marked recurring', () => {
        const r = run([...monthly('Enel Energia', [50, 62, 58], { category: 'Utilities' }), ...monthly('Allianz', [32, 32, 32], { category: 'Insurance' }, '09'), ...monthly('Affitto', [380, 380, 380], { category: 'Other' }, '12')]);
        expect(of(r, 'subscription_review')).toHaveLength(0);
        expect(of(r, 'fixed_cost').map((o) => o.params.name).sort()).toEqual(['Affitto', 'Allianz', 'Enel']);
        const marked = run(monthly('Rent', [380, 380, 380], { category: 'Housing', recurringData: { isActive: true, frequency: 'monthly' } }));
        expect(marked.all).toHaveLength(0);
    });
    it('Klarna instalments and transfers are not subscriptions', () => {
        const r = run([...monthly('Klarna', [39.9, 39.9, 39.9], { category: 'Shopping' }), ...monthly('To savings', [100, 100, 100], { transactionType: 'transfer', category: 'Transfer' }, '10')]);
        expect(of(r, 'subscription_review')).toHaveLength(0);
        expect(of(r, 'fixed_cost')).toHaveLength(0);
    });
    it('a restaurant or a shop visited about monthly is not a subscription', () => {
        const r = run([...monthly('Pizzeria Da Mario', [28, 35.5, 22, 41]), ...monthly('Eurospin', [19.9, 24.9, 21.4, 23], { category: 'Groceries' }, '12')]);
        expect(of(r, 'subscription_review')).toHaveLength(0);
        expect(of(r, 'price_creep')).toHaveLength(0);
    });
    it('a supermarket visited weekly is not a recurring charge', () => {
        const weekly = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'].map((date) => tx({ merchant: 'Lidl', category: 'Groceries', total: 30, date }));
        expect(of(run(weekly), 'subscription_review')).toHaveLength(0);
    });
    it('needs three equal charges unless the owner filed it as a subscription; ended ones are dropped', () => {
        expect(of(run(monthly('Gym', [30, 30], { category: 'Health' })), 'subscription_review')).toHaveLength(0);
        expect(of(run(monthly('Gym', [30, 30, 30], { category: 'Health' })), 'subscription_review')).toHaveLength(1);
        expect(of(run(monthly('Disney', [8.99, 8.99], { category: 'Other', groupName: 'Subscriptions' })), 'subscription_review')).toHaveLength(1);
        expect(of(run(monthly('Old', [9, 9, 9], { category: 'Subscriptions' }, '04', 5)), 'subscription_review')).toHaveLength(0); // last charge in July
    });
    it('detectRecurringCharges keeps charges marked recurring and reports their class', () => {
        const rows = monthly('Rent', [380, 380], { recurringData: { isActive: true } }).map((t) => ({ id: t.id, tx: t, date: t.date, amount: t.total, key: 'rent', name: 'Rent', category: 'Housing', cls: 'fixed', trip: false }));
        expect(detectRecurringCharges(rows)[0]).toMatchObject({ key: 'rent', count: 2, marked: true, cls: 'fixed', amount: 380 });
    });
});

describe('price_creep', () => {
    it('reports a rise against the charge own history and replaces the plain review of the same subscription', () => {
        const r = run(monthly('Netflix', [12.99, 12.99, 15.99, 15.99], { category: 'Subscriptions' }));
        const [o] = of(r, 'price_creep');
        expect(o.params).toMatchObject({ name: 'Netflix', from: 12.99, to: 15.99, increase: 3, since: '2026-10-04', monthly: 15.99, yearly: 191.88, yearlyIncrease: 36 });
        expect(o).toMatchObject({ monthlySaving: 3, yearlySaving: 36, level: 'high', action: { type: 'review_subscription', merchant: 'netflix' } });
        expect(of(r, 'subscription_review')).toHaveLength(0);
    });
    it('no rise when the price went back down, and a bill that moves every month is not a rise', () => {
        expect(of(run(monthly('Netflix', [12.99, 15.99, 12.99], { category: 'Subscriptions' })), 'price_creep')).toHaveLength(0);
        expect(of(run(monthly('Enel Energia', [50, 58, 66], { category: 'Utilities' })), 'price_creep')).toHaveLength(0);
    });
    it('a fixed cost that was stable and then rose is reported (rent increase)', () => {
        const [o] = of(run(monthly('Rent', [380, 380, 400], { category: 'Housing', recurringData: { isActive: true } })), 'price_creep');
        expect(o.params).toMatchObject({ from: 380, to: 400, increase: 20 });
    });
});

describe('category_above_baseline', () => {
    const dining = (amounts, day = '10') => amounts.map((total, i) => tx({ category: 'Dining', merchant: `Place ${i}`, total, date: `2026-${String(8 + i).padStart(2, '0')}-${day}` }));
    it('compares with the median of the previous three periods and suggests a budget when there is none', () => {
        const r = run([...dining([100, 60, 80]), tx({ category: 'Dining', total: 130, date: '2026-11-10' })]);
        const [o] = of(r, 'category_above_baseline');
        expect(o.params).toMatchObject({ category: 'Dining', current: 130, baseline: 80, excess: 50, pct: 63, periods: 3, suggestedBudget: 80, running: true, elapsedDays: 20 });
        expect(o).toMatchObject({ monthlySaving: 50, yearlySaving: 600, level: 'high', action: { type: 'set_budget', category: 'Dining', amount: 80 } });
        expect(o.scope).toEqual({ start: '2026-11-01', end: '2026-11-20' });
    });
    it('a running period is compared with the same elapsed days of earlier periods, never a full period', () => {
        // earlier months: 30 early, 200 late. Today is the 20th: the baseline is 30, not 230
        const past = ['08', '09', '10'].flatMap((m) => [tx({ category: 'Dining', total: 30, date: `2026-${m}-05` }), tx({ category: 'Dining', total: 200, date: `2026-${m}-25` })]);
        const r = run([...past, tx({ category: 'Dining', total: 70, date: '2026-11-06' })]);
        expect(of(r, 'category_above_baseline')[0].params).toMatchObject({ current: 70, baseline: 30, excess: 40 });
        // the same spend against the full earlier periods would look like a drop; once the period is over the full period is used
        const closed = computeOpportunities({ transactions: [...past, tx({ category: 'Dining', total: 70, date: '2026-11-06' })], period: '2026-11', today: '2026-12-05' });
        expect(of(closed, 'category_above_baseline')).toHaveLength(0);
    });
    it('opens the exact list instead when the category already has a budget', () => {
        const budgets = [{ id: 'b', category: 'Dining', amount: 90, currency: 'EUR', startsOn: '2026-01-01' }];
        const r = run([...dining([100, 60, 80]), tx({ category: 'Dining', total: 130, date: '2026-11-10' })], { budgets });
        expect(of(r, 'category_above_baseline')[0].action).toEqual({ type: 'open_filter', category: 'Dining' });
    });
    it('no history, one period, small differences', () => {
        expect(run([tx({ total: 500 })]).all).toHaveLength(0); // nothing to compare with
        const one = run([tx({ category: 'Dining', total: 60, date: '2026-10-10' }), tx({ category: 'Dining', total: 100, date: '2026-11-10' })]);
        expect(of(one, 'category_above_baseline')[0]).toMatchObject({ level: 'low', monthlySaving: 40 });
        expect(of(one, 'category_above_baseline')[0].params.periods).toBe(1);
        expect(of(run([...dining([100, 100, 100]), tx({ category: 'Dining', total: 110, date: '2026-11-10' })]), 'category_above_baseline')).toHaveLength(0);
    });
    it('periods before the first recorded transaction do not count as zero', () => {
        const r = run([tx({ category: 'Dining', total: 60, date: '2026-10-10' }), tx({ category: 'Dining', total: 100, date: '2026-11-10' })]);
        expect(of(r, 'category_above_baseline')[0].params.baseline).toBe(60); // not the median of [0, 0, 60]
    });
    it('uses the owner share of split expenses and leaves out fixed costs, debt, trips, planned bills, refunds and income', () => {
        const split = { v: 2, payer: 'me', participants: [{ id: 'me', name: 'Me' }, { id: 'p', name: 'P' }], method: 'equal', shares: { me: 6500, p: 6500 } };
        const r = run([...dining([100, 60, 80]), tx({ category: 'Dining', total: 130, date: '2026-11-10', splitData: split })]);
        expect(of(r, 'category_above_baseline')).toHaveLength(0); // my share is 65, below the baseline of 80
        const noise = run([
            ...['08', '09', '10'].flatMap((m) => [tx({ category: 'Housing', merchant: 'Rent', total: 380, date: `2026-${m}-02` }), tx({ category: 'Debt', merchant: 'Klarna', total: 40, date: `2026-${m}-07` }), tx({ category: 'Shopping', total: 30, date: `2026-${m}-09` })]),
            tx({ category: 'Housing', merchant: 'Rent', total: 900, date: '2026-11-02' }),
            tx({ category: 'Debt', merchant: 'Klarna', total: 400, date: '2026-11-07' }),
            tx({ category: 'Shopping', total: 30, date: '2026-11-09' }),
            tx({ category: 'Shopping', total: 300, date: '2026-11-10', groupId: 'trip', groupName: 'Lisbon' }),
            tx({ category: 'Shopping', total: 300, date: '2026-11-11', trackingData: { isTracked: true, status: 'open' } }),
            tx({ category: 'Income', merchant: 'Refund', total: 300, date: '2026-11-12', transactionType: 'income' }),
        ], { trips: [{ id: 'trip', kind: 'trip', excludeFromBudgets: true }] });
        expect(of(noise, 'category_above_baseline')).toHaveLength(0);
    });
    it('the first days of a running period are too few to judge', () => {
        const r = computeOpportunities({ transactions: [...dining([20, 20, 20], '02'), tx({ category: 'Dining', total: 90, date: '2026-11-02' })], period: '2026-11', today: '2026-11-03' });
        expect(of(r, 'category_above_baseline')).toHaveLength(0);
    });
});

describe('merchant_frequency', () => {
    const visits = (days, o = {}) => days.map((d) => tx({ merchant: 'Tabaccheria Centrale', category: 'Other', total: 5.5, date: `2026-11-${String(d).padStart(2, '0')}`, ...o }));
    it('many small purchases at one place: count, total, average ticket and one fewer visit a week', () => {
        const r = run(visits([1, 3, 5, 8, 10, 12, 15, 17]));
        const [o] = of(r, 'merchant_frequency');
        expect(o.params).toMatchObject({ name: 'Tabaccheria Centrale', count: 8, total: 44, average: 5.5, perWeek: 2.8, days: 20, weeklySaving: 5.5 });
        expect(o).toMatchObject({ monthlySaving: 23.83, yearlySaving: 285.96, action: { type: 'open_filter', merchant: 'tabaccheria centrale' } });
        expect(o.evidence).toHaveLength(8);
    });
    it('not for a few visits, large tickets, fixed costs or subscriptions', () => {
        expect(of(run(visits([1, 8, 15])), 'merchant_frequency')).toHaveLength(0);
        expect(of(run(visits([1, 3, 5, 8, 10, 12], { total: 45, merchant: 'Conad', category: 'Groceries' })), 'merchant_frequency')).toHaveLength(0);
        expect(of(run(visits([1, 3, 5, 8, 10, 12], { merchant: 'Enel Energia', category: 'Utilities' })), 'merchant_frequency')).toHaveLength(0);
    });
    it('the saving is never more than what was spent there', () => {
        const [o] = of(run(visits([12, 14, 16, 18, 20], { total: 14 })), 'merchant_frequency');
        expect(o.monthlySaving).toBeLessThanOrEqual(o.params.total);
    });
});

describe('cheaper_store', () => {
    const shop = (merchant, totals, o = {}) => totals.map((total, i) => tx({ merchant, category: 'Groceries', total, date: `2026-${i % 2 ? '10' : '11'}-${String(3 + i * 2).padStart(2, '0')}`, ...o }));
    it('without item data it compares the average basket per visit and says so (honest coverage, low confidence)', () => {
        const r = run([...shop('Lidl', [28, 30, 32]), ...shop('Conad', [44, 48, 52]), ...shop('Eurospin', [20, 22])]);
        const [o] = of(r, 'cheaper_store');
        expect(o.params).toMatchObject({ basis: 'basket', cheaper: 'Lidl', pricier: 'Conad', cheaperAverage: 30, pricierAverage: 48, difference: 18, cheaperVisits: 3, pricierVisits: 3, days: 90, coveragePct: 0, receipts: 8, receiptsWithItems: 0 });
        expect(o).toMatchObject({ level: 'low', monthlySaving: 18, action: { type: 'open_filter', category: 'Groceries', merchant: 'conad' } });
        expect(o.scope).toEqual({ start: '2026-08-23', end: '2026-11-20' });
    });
    it('needs two stores with at least three visits each', () => {
        expect(of(run([...shop('Lidl', [28, 30, 32]), ...shop('Conad', [44, 48])]), 'cheaper_store')).toHaveLength(0);
    });
    it('with comparable items it compares unit prices of the same product and never mixes units', () => {
        const item = (name, amount, quantity, unit) => ({ v: 2, id: `${name}-${amount}`, name, amount, price: amount, quantity, unit, category: 'Groceries', reviewStatus: 'confirmed', userEdited: [] });
        const lidl = [item('Latte intero', 1.09, 1, 'l'), item('Mozzarella', 5.4, 0.6, 'kg'), item('Uova', 2.2, 10, 'pc')];
        const conad = [item('Latte intero', 1.49, 1, 'l'), item('Mozzarella', 7.8, 0.6, 'kg'), item('Uova', 2.5, 1, 'kg')]; // eggs by weight: not comparable with eggs by piece
        const r = run([...shop('Lidl', [28, 30, 32], { lineItems: lidl }), ...shop('Conad', [44, 48, 52], { lineItems: conad })]);
        const [o] = of(r, 'cheaper_store');
        expect(o.params).toMatchObject({ basis: 'items', cheaper: 'Lidl', pricier: 'Conad', products: 2, coveragePct: 100 });
        expect(o.params.examples).toEqual([{ name: 'Latte intero', base: 'l', cheaperPrice: 1.09, pricierPrice: 1.49 }, { name: 'Mozzarella', base: 'kg', cheaperPrice: 9, pricierPrice: 13 }]);
        // (0.40 x 3 l + 4 x 1.8 kg) over 90 days -> a month
        expect(o.monthlySaving).toBe(2.8);
        expect(o.level).toBe('medium');
    });
});

describe('budget_gap', () => {
    const shopping = (amounts) => amounts.map((total, i) => tx({ category: 'Shopping', merchant: 'Zara', total, date: `2026-${String(8 + i).padStart(2, '0')}-10` }));
    it('a large, volatile category without a budget gets a budget at its three-period median', () => {
        const r = run([...shopping([40, 120, 60]), tx({ category: 'Shopping', total: 20, date: '2026-11-10' })]);
        const [o] = of(r, 'budget_gap');
        expect(o.params).toMatchObject({ category: 'Shopping', median: 60, suggestedBudget: 60, lowest: 40, highest: 120, periods: 3, averageOver: 20 });
        expect(o).toMatchObject({ monthlySaving: 20, action: { type: 'set_budget', category: 'Shopping', amount: 60 } });
        expect(o.scope).toEqual({ start: '2026-08-01', end: '2026-10-31' });
    });
    it('not when a budget exists, the category is steady or small, or it is already reported as above baseline', () => {
        const budgets = [{ id: 'b', category: 'Shopping', amount: 60, currency: 'EUR', startsOn: '2026-01-01' }];
        expect(of(run(shopping([40, 120, 60]), { budgets }), 'budget_gap')).toHaveLength(0);
        expect(of(run(shopping([60, 62, 61])), 'budget_gap')).toHaveLength(0);
        expect(of(run(shopping([10, 30, 20])), 'budget_gap')).toHaveLength(0);
        const both = run([...shopping([40, 120, 60]), tx({ category: 'Shopping', total: 200, date: '2026-11-10' })]);
        expect(of(both, 'category_above_baseline')).toHaveLength(1);
        expect(of(both, 'budget_gap')).toHaveLength(0);
    });
    it('rent and debt never get a "budget to cut" suggestion', () => {
        const r = run(['08', '09', '10'].flatMap((m, i) => [tx({ category: 'Housing', merchant: 'Rent', total: [380, 500, 420][i], date: `2026-${m}-02` }), tx({ category: 'Debt', merchant: 'Marco', total: [50, 150, 80][i], date: `2026-${m}-12` })]));
        expect(of(r, 'budget_gap')).toHaveLength(0);
    });
});

describe('debt_cost', () => {
    const klarna = (o = {}) => monthly('Klarna', [39.9, 39.9, 39.9, 39.9], { category: 'Debt', groupId: 'g-debts', groupName: 'Debts', ...o }, '07');
    it('instalments as a share of income, never as spending to cut', () => {
        const r = run([...klarna(), tx({ merchant: 'Marco', category: 'Debt', groupId: 'g-debts', groupName: 'Debts', total: 60.1, date: '2026-11-09' }), tx({ merchant: 'Salary', category: 'Income', transactionType: 'income', total: 1000, date: '2026-11-01' })]);
        const [o] = of(r, 'debt_cost');
        expect(o.params).toMatchObject({ amount: 100, count: 2, incomePct: 10, income: 1000, incomeBasis: 'period', instalment: 39.9, endsOn: null, typical: 39.9 });
        expect(o).toMatchObject({ monthlySaving: 0, yearlySaving: 0, action: { type: 'open_filter', groupId: 'g-debts' } });
        expect(of(r, 'subscription_review')).toHaveLength(0);
        expect(of(r, 'category_above_baseline')).toHaveLength(0);
    });
    it('uses the typical income when none is logged yet this period, and says so', () => {
        const r = run([...klarna(), ...['08', '09', '10'].map((m) => tx({ merchant: 'Salary', category: 'Income', transactionType: 'income', total: 1400, date: `2026-${m}-01` }))]);
        expect(of(r, 'debt_cost')[0].params).toMatchObject({ incomePct: 3, income: 1400, incomeBasis: 'typical' });
        expect(of(run(klarna()), 'debt_cost')[0].params).toMatchObject({ incomePct: null, income: null, incomeBasis: 'none' });
    });
    it('gives an end date only when the pattern shows one', () => {
        const noted = klarna().map((t, i) => ({ ...t, notes: `rata ${i + 3} di 8` }));
        expect(of(run(noted), 'debt_cost')[0].params.endsOn).toBe('2027-01-06'); // 6 of 8 on 7 Nov: two more, a month apart
        const dated = klarna({ recurringData: { isActive: true, endDate: '2027-02-07' } });
        expect(of(run(dated), 'debt_cost')[0].params.endsOn).toBe('2027-02-07');
    });
});

describe('uncategorised_blind_spot', () => {
    it('reports the share of spending without a category and offers to categorise', () => {
        const r = run([...[1, 2, 3, 4].map((d) => tx({ category: d % 2 ? 'Other' : '', merchant: ['Alfa', 'Beta', 'Gamma', 'Delta'][d - 1], total: 25, date: `2026-11-0${d}` })), tx({ category: 'Groceries', merchant: 'Lidl', total: 100, date: '2026-11-05' })]);
        const [o] = of(r, 'uncategorised_blind_spot');
        expect(o.params).toMatchObject({ amount: 100, total: 200, pct: 50, count: 4, isLargest: true });
        expect(o.params.names).toHaveLength(3);
        expect(o).toMatchObject({ monthlySaving: 0, action: { type: 'categorise' }, level: 'high' });
    });
    it('not for a couple of rows or a small share that is not the largest category', () => {
        expect(of(run([tx({ category: 'Other', total: 500 }), tx({ category: 'Other', total: 500 })]), 'uncategorised_blind_spot')).toHaveLength(0);
        const small = run([...[1, 2, 3].map((d) => tx({ category: 'Other', total: 5, date: `2026-11-0${d}` })), tx({ category: 'Groceries', total: 400 })]);
        expect(of(small, 'uncategorised_blind_spot')).toHaveLength(0);
    });
});

describe('goal_boost', () => {
    const goals = [{ id: 'goal', name: 'Emergency fund', targetAmount: 1000, startingAmount: 400, isArchived: false }];
    const base = [...[100, 60, 80].map((total, i) => tx({ category: 'Dining', total, date: `2026-${String(8 + i).padStart(2, '0')}-10` })), tx({ category: 'Dining', total: 130, date: '2026-11-10' })];
    it('how much sooner the goal completes when the top saving goes to it', () => {
        const transfers = ['09', '10', '11'].map((m) => tx({ transactionType: 'transfer', category: 'Transfer', merchant: 'To goal', total: 40, goalId: 'goal', date: `2026-${m}-15` }));
        const r = run([...base, ...transfers], { goals });
        const [o] = of(r, 'goal_boost');
        // 600 - 120 saved by transfers = 480 left; pace 40 a period -> 12 periods; with 50 more -> 6
        expect(o.params).toMatchObject({ goal: 'Emergency fund', saving: 50, remaining: 480, pace: 40, monthsNow: 12, monthsWith: 6, sooner: 6, sourceKind: 'category_above_baseline', sourceCategory: 'Dining' });
        expect(o.action).toEqual({ type: 'add_goal', goalId: 'goal', amount: 50 });
        expect(o.monthlySaving).toBe(0); // never counted twice
    });
    it('a goal nobody pays into gets a first date; no goal or no saving, no card', () => {
        const [o] = of(run(base, { goals }), 'goal_boost');
        expect(o.params).toMatchObject({ pace: 0, monthsNow: null, monthsWith: 12, sooner: null });
        expect(of(run(base), 'goal_boost')).toHaveLength(0);
        expect(of(run([tx({ total: 5 })], { goals }), 'goal_boost')).toHaveLength(0);
        expect(of(run(base, { goals: [{ ...goals[0], isArchived: true }] }), 'goal_boost')).toHaveLength(0);
    });
});

describe('ranking, dismissal and the model view', () => {
    const d = ownerLike();
    const period = currentCyclePeriod(normalizeConfig(d.config), new Date(`${TODAY}T12:00:00Z`));
    const r = computeOpportunities({ ...d, period });
    it('owner-like data: at most five, ranked by saving x confidence, one card per subject, every card has one working action', () => {
        expect(d.transactions.length).toBeGreaterThan(240);
        expect(r.top.length).toBeLessThanOrEqual(5);
        expect(r.top.map((o) => o.kind)).toEqual(['category_above_baseline', 'goal_boost', 'merchant_frequency', 'budget_gap', 'uncategorised_blind_spot']);
        const scores = r.top.map((o) => o.score);
        expect([...scores].sort((a, b) => b - a)).toEqual(scores);
        for (const o of r.all) {
            expect(OPPORTUNITY_KINDS).toContain(o.kind);
            expect(OPPORTUNITY_ACTIONS).toContain(o.action.type);
            expect(o.yearlySaving).toBeCloseTo(o.monthlySaving * 12, 1);
            expect(['high', 'medium', 'low']).toContain(o.level);
            expect(o.scope.start <= o.scope.end).toBe(true);
            expect(o.evidence.every((id) => d.transactions.some((t) => t.id === id))).toBe(true);
        }
        expect(new Set(r.all.map((o) => o.id)).size).toBe(r.all.length);
    });
    it('owner-like data: rent and the energy bill are fixed costs, Klarna is debt, the monthly shop is not a subscription', () => {
        expect(of(r, 'subscription_review').map((o) => o.merchant)).toEqual(['spotify']);
        expect(of(r, 'price_creep').map((o) => o.merchant)).toEqual(['netflix']);
        expect(of(r, 'fixed_cost').map((o) => o.merchant).sort()).toEqual(['affitto', 'enel energia']);
        expect(of(r, 'debt_cost')[0].params.names).toEqual(['Klarna']);
        expect(of(r, 'cheaper_store')[0].params).toMatchObject({ basis: 'items', coveragePct: 25, receiptsWithItems: 4 });
        expect(r.all.some((o) => o.kind !== 'fixed_cost' && o.kind !== 'price_creep' && ['affitto', 'enel energia'].includes(o.merchant))).toBe(false);
    });
    it('"Not useful" hides a suggestion for 60 days and keeps it out of the ranking', () => {
        const dismissed = { 'category_above_baseline:Dining': '2026-11-01' };
        const again = computeOpportunities({ ...d, period, dismissed });
        expect(again.top.some((o) => o.key === 'category_above_baseline:Dining')).toBe(false);
        expect(again.dismissed.map((o) => o.key)).toEqual(['category_above_baseline:Dining']);
        // the goal card now follows the next best saving
        expect(again.top.find((o) => o.kind === 'goal_boost').params.sourceKind).not.toBe('category_above_baseline');
        expect(isDismissed('k', { k: '2026-09-14' }, '2026-11-12')).toBe(true); // day 59
        expect(isDismissed('k', { k: '2026-09-13' }, '2026-11-12')).toBe(false); // day 60: shown again
        expect(DISMISS_DAYS).toBe(60);
        expect(pruneDismissed({ a: '2026-01-01', b: '2026-11-01' }, '2026-11-12')).toEqual({ b: '2026-11-01' });
        expect(toModelDismissed(again.dismissed)).toEqual([{ oppKind: 'category_above_baseline', category: 'Dining', merchant: null }]);
    });
    it('the model gets numbers and names under short ids, never transaction ids', () => {
        const sent = toModelOpportunities(r.top);
        expect(sent.map((o) => o.id)).toEqual(['O1', 'O2', 'O3', 'O4', 'O5']);
        expect(sent[0]).toMatchObject({ oppKind: 'category_above_baseline', category: 'Dining', monthlySaving: r.top[0].monthlySaving, yearlySaving: r.top[0].yearlySaving, confidence: 'high', action: 'set_budget', periodStart: '2026-10-27', periodEnd: '2026-11-12' });
        const text = JSON.stringify(sent);
        for (const t of d.transactions) expect(text.includes(`"${t.id}"`)).toBe(false);
        expect(totalMonthlySaving(r.top)).toBe(Math.round(r.top.reduce((s, o) => s + o.monthlySaving, 0) * 100) / 100);
    });
    it('is deterministic and independent of input order; empty and future periods give nothing', () => {
        const shuffled = computeOpportunities({ ...d, transactions: [...d.transactions].reverse(), period });
        expect(shuffled.top.map((o) => [o.id, o.monthlySaving])).toEqual(r.top.map((o) => [o.id, o.monthlySaving]));
        expect(computeOpportunities({})).toEqual({ top: [], all: [], dismissed: [] });
        expect(computeOpportunities({ ...d, period: '2027-03' }).top).toEqual([]);
    });
});
