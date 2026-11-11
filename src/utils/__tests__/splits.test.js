import { describe, expect, it } from 'vitest';
import { ME, addPerson, buildSettlement, buildSplit, distribute, effectiveAmount, itemShareFraction, obligationsOf, owedToMe, iOwe, paidByOther, personBalances, readSplit, rescaleSplit } from '../splits';
import { accountBalances, monthTotals, shareAmount, fullAmount } from '../money';
import { allocationsOf, spendByCategory } from '../itemAnalysis';

const P = (...names) => [{ id: ME, name: 'Me' }, ...names.map((n) => ({ id: n.toLowerCase(), name: n }))];
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

describe('case 5: odd-cent equal and item splits reconcile exactly', () => {
    it('10.00 between 3 people: 3.34 / 3.33 / 3.33, the leftover cent is named', () => {
        const r = buildSplit({ total: 10, method: 'equal', participants: P('Marta', 'Luca') });
        expect(r.split.shares).toEqual({ me: 334, marta: 333, luca: 333 });
        expect(r.remainder).toEqual({ cents: 1, to: ['me'] });
        expect(sum(r.split.shares)).toBe(1000);
    });
    it('every total and group size adds up to the cent, leftovers go to the earliest participants', () => {
        for (const total of [0.01, 0.02, 9.99, 10.01, 33.33, 100, 1234.57]) {
            for (let n = 2; n <= 7; n++) {
                const people = P(...Array.from({ length: n - 1 }, (_, i) => `P${i}`));
                const { split, remainder } = buildSplit({ total, method: 'equal', participants: people });
                expect(sum(split.shares)).toBe(Math.round(total * 100));
                const vals = Object.values(split.shares);
                expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
                expect(remainder.cents).toBe(Math.round(total * 100) % n);
            }
        }
    });
    it('percent split uses largest remainder and rejects percentages that do not add up', () => {
        const ok = buildSplit({ total: 10, method: 'percent', participants: P('Marta'), percents: { me: 33.33, marta: 66.67 } });
        expect(ok.ok).toBe(true);
        expect(sum(ok.split.shares)).toBe(1000);
        expect(ok.split.shares).toEqual({ me: 333, marta: 667 });
        const bad = buildSplit({ total: 10, method: 'percent', participants: P('Marta'), percents: { me: 40, marta: 50 } });
        expect(bad.ok).toBe(false);
        expect(bad.difference).toBe(1000);
    });
    it('fixed amounts must add up to the total; the gap is reported', () => {
        expect(buildSplit({ total: 10, method: 'fixed', participants: P('Marta'), fixed: { me: 4.5, marta: 5.5 } }).ok).toBe(true);
        const r = buildSplit({ total: 10, method: 'fixed', participants: P('Marta'), fixed: { me: 4.5, marta: 5 } });
        expect(r).toMatchObject({ ok: false, difference: 50 });
    });
    it('item split with a discount line and an unallocated remainder reconciles to the receipt total', () => {
        const items = [
            { v: 2, id: 'a', name: 'Pasta', amount: 3.35, category: 'Groceries' },
            { v: 2, id: 'b', name: 'Vino', amount: 8.9, category: 'Groceries' },
            { v: 2, id: 'c', name: 'Sconto', amount: -1.2, category: 'Groceries' },
        ];
        // total 15.01: items sum 11.05, 3.96 not itemised
        const r = buildSplit({ total: 15.01, method: 'items', participants: P('Marta', 'Luca'), items, allocations: { a: ['me', 'marta', 'luca'], b: ['marta'], c: ['marta'] } });
        expect(sum(r.split.shares)).toBe(1501);
        expect(r.split.itemAllocations.a).toEqual({ me: 112, marta: 112, luca: 111 }); // 3.35 / 3, leftover cent to the first
        expect(r.split.itemAllocations.b).toEqual({ marta: 890 });
        expect(r.split.itemAllocations.c).toEqual({ marta: -120 });
        expect(sum(r.split.unallocated)).toBe(396);
        expect(r.split.shares.me).toBe(112 + 132);
        expect(r.remainder.cents).toBeGreaterThan(0);
    });
});

describe('personal share vs cash movement', () => {
    const tx = (extra) => ({ id: 't', transactionType: 'expense', total: 90, currency: 'EUR', date: '2026-11-05', accountId: 'a1', category: 'Dining', ...extra });
    const accounts = [{ id: 'a1', name: 'Revolut', kind: 'spending', currency: 'EUR', openingBalance: 500 }];

    it('I paid, split equally: spending is my share, the account loses the full amount', () => {
        const split = buildSplit({ total: 90, participants: P('Marta', 'Luca') }).split;
        const t = tx({ splitData: split });
        expect(shareAmount(t)).toBe(30);
        expect(fullAmount(t)).toBe(90);
        expect(monthTotals([t], '2026-11').spent).toBe(30);
        expect(accountBalances(accounts, [t])[0].balance).toBe(410);
    });
    it('somebody else paid: my share is spending, nothing left my account', () => {
        const split = buildSplit({ total: 90, participants: P('Marta', 'Luca'), payer: 'marta' }).split;
        const t = tx({ splitData: split });
        expect(paidByOther(t)).toBe(true);
        expect(monthTotals([t], '2026-11').spent).toBe(30);
        expect(accountBalances(accounts, [t])[0].balance).toBe(500);
    });
    it('odd cents: my share and the account differ by exactly what the others owe', () => {
        const split = buildSplit({ total: 10, participants: P('Marta', 'Luca') }).split;
        const t = tx({ total: 10, splitData: split });
        expect(effectiveAmount(t)).toBe(3.34);
        expect(accountBalances(accounts, [t])[0].balance).toBe(490);
        expect(personBalances([t], [{ id: 'marta', name: 'Marta' }, { id: 'luca', name: 'Luca' }]).map((b) => [b.id, b.cents])).toEqual([['luca', 333], ['marta', 333]]);
    });
    it('item-level shares drive item analysis: each line counts only my part', () => {
        const items = [{ v: 2, id: 'a', name: 'Pasta', amount: 6, price: 6, category: 'Groceries' }, { v: 2, id: 'b', name: 'Birra', amount: 4, price: 4, category: 'Groceries' }];
        const split = buildSplit({ total: 10, method: 'items', participants: P('Marta'), items, allocations: { a: ['me', 'marta'], b: ['marta'] } }).split;
        const t = tx({ total: 10, category: 'Groceries', lineItems: items, splitData: split });
        expect(itemShareFraction(t, 'a')).toBe(0.5);
        expect(itemShareFraction(t, 'b')).toBe(0);
        const rows = allocationsOf(t);
        expect(rows.find((r) => r.itemId === 'a').amount).toBe(3);
        expect(rows.find((r) => r.itemId === 'b').amount).toBe(0);
        expect(spendByCategory([t], '2026-11')[0].total).toBe(shareAmount(t));
        expect(allocationsOf(t, { basis: 'full' }).reduce((s, r) => s + r.amount, 0)).toBe(10);
    });
});

describe('settlements and balances', () => {
    const people = [{ id: 'marta', name: 'Marta' }];
    const dinner = { id: 'd1', transactionType: 'expense', total: 60, currency: 'EUR', date: '2026-11-02', accountId: 'a1', splitData: buildSplit({ total: 60, participants: P('Marta') }).split };
    const accounts = [{ id: 'a1', name: 'Revolut', kind: 'spending', currency: 'EUR', openingBalance: 100 }];

    it('who owes me, per person, and what settling does', () => {
        expect(personBalances([dinner], people)[0]).toMatchObject({ id: 'marta', cents: 3000 });
        const settle = { id: 's1', ...buildSettlement({ userId: 'u', person: people[0], direction: 'received', amount: 30, date: '2026-11-04', accountId: 'a1', settles: ['d1'] }) };
        const b = personBalances([dinner, settle], people)[0];
        expect(b.cents).toBe(0);
        expect(b.events.find((e) => e.txId === 'd1').settled).toBe(true);
        // never spending, never income; money arrives in the account
        expect(monthTotals([dinner, settle], '2026-11')).toMatchObject({ spent: 30, income: 0, saved: 0 });
        expect(accountBalances(accounts, [dinner, settle])[0].balance).toBe(100 - 60 + 30);
    });
    it('partial settlement leaves the rest open; I can also owe', () => {
        const part = { id: 's2', ...buildSettlement({ userId: 'u', person: people[0], direction: 'received', amount: 10, date: '2026-11-04', accountId: 'a1' }) };
        expect(personBalances([dinner, part], people)[0].cents).toBe(2000);
        const theyPaid = { id: 'd2', transactionType: 'expense', total: 40, date: '2026-11-06', splitData: buildSplit({ total: 40, participants: P('Marta'), payer: 'marta' }).split };
        const all = personBalances([dinner, theyPaid], people);
        expect(all[0].cents).toBe(1000); // she owes 30, I owe 20
        expect(owedToMe(all)).toBe(1000);
        const justMine = personBalances([theyPaid], people);
        expect(iOwe(justMine)).toBe(2000);
        const pay = { id: 's3', ...buildSettlement({ userId: 'u', person: people[0], direction: 'paid', amount: 20, date: '2026-11-07', accountId: 'a1' }) };
        expect(personBalances([theyPaid, pay], people)[0].cents).toBe(0);
        expect(accountBalances(accounts, [pay])[0].balance).toBe(80);
    });
    it('a refund of a shared purchase reverses the obligations; editing the amount keeps the relationships', () => {
        const refund = { ...dinner, id: 'r1', transactionType: 'income', total: 60, date: '2026-11-09' };
        expect(obligationsOf(refund)[0].cents).toBe(-3000);
        expect(personBalances([dinner, refund], people)[0].cents).toBe(0);
        const edited = { ...dinner, total: 70 };
        expect(readSplit(edited.splitData, 70).shares).toEqual({ me: 3500, marta: 3500 });
        expect(personBalances([edited], people)[0].cents).toBe(3500);
    });
    it('payer cannot be forgotten: paying for others entirely gives me no share', () => {
        const split = buildSplit({ total: 20, participants: [{ id: 'marta', name: 'Marta' }] }).split;
        expect(effectiveAmount({ total: 20, splitData: split })).toBe(0);
        expect(personBalances([{ id: 'x', transactionType: 'expense', total: 20, date: '2026-11-01', splitData: split }], people)[0].cents).toBe(2000);
    });
});

describe('old shapes and helpers', () => {
    it('reads legacy equal, yourShare and custom splits without rewriting them', () => {
        expect(readSplit({ method: 'equal', people: 3 }, 100).shares).toEqual({ me: 3334, p2: 3333, p3: 3333 });
        expect(readSplit({ yourShare: 30 }, 100).shares.me).toBe(3000);
        expect(readSplit({ method: 'custom', users: [{ name: 'You', amount: '25' }, { name: 'Ana', amount: '65' }] }, 90).participants.map((p) => p.name)).toEqual(['Me', 'Ana']);
        expect(readSplit({ enabled: true, participants: [] }, 10)).toBeNull();
        expect(readSplit(null, 10)).toBeNull();
    });
    it('distribute is deterministic and sign-safe; rescale keeps proportions', () => {
        expect(distribute(100, [1, 1, 1]).parts).toEqual([34, 33, 33]);
        expect(distribute(-100, [1, 1, 1]).parts).toEqual([-34, -33, -33]);
        const s = buildSplit({ total: 10, method: 'fixed', participants: P('A'), fixed: { me: 2, a: 8 } }).split;
        expect(rescaleSplit(s, 2000).shares).toEqual({ me: 400, a: 1600 });
    });
    it('people list: no duplicates by name', () => {
        const a = addPerson([], 'Marta');
        const b = addPerson(a.people, ' marta ');
        expect(b.people).toHaveLength(1);
        expect(b.person.id).toBe(a.person.id);
        expect(addPerson([], '  ').person).toBeNull();
    });
});
