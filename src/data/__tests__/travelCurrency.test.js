// Brief section 12 case 7 (foreign currency offline) and section 9: original kept, EUR amount missing or rate-based, never 1:1,
// confirmed charges from the bank survive, no silent revaluation, same basis everywhere.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../services/supabaseService', () => ({ supabase: null, authHelpers: {}, supabaseService: {} }));
vi.mock('../../services/exchangeRateService', () => ({ getRate: vi.fn(async () => null), getRateInfo: vi.fn(async () => null) }));
vi.mock('../../data/queryClient', () => ({ notifyDataChanged: vi.fn(), queryClient: {} }));
import { getRateInfo } from '../../services/exchangeRateService';
import { db, openDb } from '../db';
import { createTransaction, fillMissingBaseAmounts, getTransaction, recalculateBaseAmounts, updateTransaction } from '../repo';
import { fullAmount, monthTotals, shareAmount } from '../../utils/money';
import { pendingConversionCount } from '../../utils/conversion';
import { fxInfo, fxStatus } from '../../utils/fx';
import { applyImport, buildPreview } from '../../import/importFlow';
import { findDuplicates } from '../../import/dedupe';
import { eligibleForAutoTrip, tripForDate } from '../../utils/tripMath';
import { obligationsOf } from '../../utils/splits';
import { buildEvidencePack } from '../../services/evidencePack';

const U = 'u1';
const NOV = '2026-11';
const mk = (extra = {}) => createTransaction({ userId: U, merchant: 'Cafe Lisboa', total: 50, currency: 'USD', date: '2026-11-03', category: 'Dining', ...extra });

beforeEach(async () => {
    await openDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    getRateInfo.mockReset();
    getRateInfo.mockResolvedValue(null);
});

describe('case 7: foreign currency offline', () => {
    it('keeps the original amount and currency, is pending, and is never counted 1:1', async () => {
        const id = await mk();
        const tx = await getTransaction(id);
        expect(tx).toMatchObject({ total: 50, currency: 'USD' });
        expect(tx.amountBase ?? null).toBeNull();
        expect(fxStatus(tx, 'EUR')).toBe('pending');
        expect(fxInfo(tx, 'EUR')).toMatchObject({ status: 'pending', originalAmount: 50, originalCurrency: 'USD', baseAmount: null });
        expect(fullAmount(tx)).toBe(0);
        expect(shareAmount(tx)).toBe(0);
        const own = await getTransaction(await mk({ currency: 'EUR', total: 10, merchant: 'Bar' }));
        expect(monthTotals([tx, own], NOV).spent).toBe(10); // the 50 USD are not added as 50 EUR
        expect(pendingConversionCount([tx, own], NOV, 'EUR')).toMatchObject({ count: 1, byCurrency: { USD: { count: 1, total: 50 } } });
    });

    it('is converted later with a daily rate: estimated, with rate, date and source; the original is untouched', async () => {
        const id = await mk();
        getRateInfo.mockResolvedValue({ rate: 0.9, date: '2026-11-11', source: 'api' });
        expect(await fillMissingBaseAmounts(U)).toBe(1);
        const tx = await getTransaction(id);
        expect(tx).toMatchObject({ total: 50, currency: 'USD', amountBase: 45, exchangeRate: 0.9 });
        expect(fxInfo(tx, 'EUR')).toMatchObject({ status: 'estimated', rate: 0.9, date: '2026-11-11', source: 'api', baseAmount: 45 });
        expect(monthTotals([tx], NOV).spent).toBe(45);
    });

    it('offline with an older cached table: estimated and labelled with that table, not today', async () => {
        getRateInfo.mockResolvedValue({ rate: 0.92, date: '2026-11-05', source: 'cache-old' });
        const tx = await getTransaction(await mk());
        expect(fxInfo(tx, 'EUR')).toMatchObject({ status: 'estimated', date: '2026-11-05', source: 'cache-old', baseAmount: 46 });
    });

    it('same-currency records are unaffected', async () => {
        const tx = await getTransaction(await mk({ currency: 'EUR' }));
        expect(fxStatus(tx, 'EUR')).toBeNull();
        expect(fullAmount(tx)).toBe(50);
    });
});

describe('confirmed charge from the bank', () => {
    const bankRow = { date: '2026-11-04', description: 'CAFE LISBOA', amount: 44.37, currency: 'EUR', transactionType: 'expense', direction: 'out', importRef: 'rev:1' };

    it('an imported Revolut row matches the foreign purchase and its EUR amount becomes the confirmed charge', async () => {
        getRateInfo.mockResolvedValue({ rate: 0.9, date: '2026-11-03', source: 'api' });
        const id = await mk();
        const existing = await getTransaction(id);
        const items = buildPreview({ rows: [bankRow], existing: [existing], trips: [], rules: [], names: [] });
        expect(items[0].duplicate.reason).toBe('fx_match');
        expect(items[0].action).toBe('merge');
        await applyImport({ items, accountId: null, userId: U, createTransaction, updateTransaction });
        const tx = await getTransaction(id);
        expect(tx).toMatchObject({ total: 50, currency: 'USD', amountBase: 44.37, importRef: 'rev:1' });
        expect(fxInfo(tx, 'EUR')).toMatchObject({ status: 'confirmed', source: 'bank', baseAmount: 44.37 });
    });

    it('also matches a pending purchase (no rate yet) when merchant and date agree', async () => {
        const existing = await getTransaction(await mk());
        expect(findDuplicates([bankRow], [existing])[0]).toMatchObject({ reason: 'fx_match' });
        expect(findDuplicates([{ ...bankRow, description: 'SOMEWHERE ELSE' }], [existing])).toEqual([]);
        expect(findDuplicates([{ ...bankRow, date: '2026-11-20' }], [existing])).toEqual([]);
    });

    it('rejects a bank row whose amount is far from the estimate', async () => {
        getRateInfo.mockResolvedValue({ rate: 0.9, date: '2026-11-03', source: 'api' });
        const existing = await getTransaction(await mk());
        expect(findDuplicates([{ ...bankRow, amount: 80 }], [existing])).toEqual([]);
    });

    it('is never revalued: recalculation and unrelated edits keep it', async () => {
        getRateInfo.mockResolvedValue({ rate: 0.9, date: '2026-11-03', source: 'api' });
        const id = await mk();
        const items = buildPreview({ rows: [bankRow], existing: [await getTransaction(id)], trips: [], rules: [], names: [] });
        await applyImport({ items, accountId: null, userId: U, createTransaction, updateTransaction });
        getRateInfo.mockResolvedValue({ rate: 1.5, date: '2026-12-01', source: 'api' }); // the market moved
        const r = await recalculateBaseAmounts(U);
        expect(r.skipped).toBeGreaterThan(0);
        await updateTransaction(id, { notes: 'dinner', total: 50, currency: 'USD' }); // saved again with the same amount
        expect((await getTransaction(id)).amountBase).toBe(44.37);
        await updateTransaction(id, { total: 60 }); // a real change of amount re-converts (and says estimated)
        const edited = await getTransaction(id);
        expect(edited.amountBase).toBe(90);
        expect(fxStatus(edited, 'EUR')).toBe('estimated');
    });

    it('an estimated record is not revalued by a notes edit either', async () => {
        getRateInfo.mockResolvedValue({ rate: 0.9, date: '2026-11-03', source: 'api' });
        const id = await mk();
        getRateInfo.mockResolvedValue({ rate: 1.2, date: '2026-12-01', source: 'api' });
        await updateTransaction(id, { notes: 'x' });
        expect((await getTransaction(id)).amountBase).toBe(45);
    });
});

describe('same basis everywhere', () => {
    it('splits skip an unconverted record and the evidence pack reports how many are missing', async () => {
        const split = { v: 2, payer: 'me', participants: [{ id: 'me', name: 'Me' }, { id: 'm', name: 'Marta' }], method: 'equal', shares: { me: 2500, m: 2500 } };
        const tx = await getTransaction(await mk({ splitData: split }));
        expect(obligationsOf(tx)).toEqual([]);
        const { pack } = buildEvidencePack({ transactions: [tx], period: NOV, today: '2026-11-20', intent: 'general' });
        expect(pack.conversion.count).toBe(1);
        expect(pack.insufficient).toBe('no_spending'); // nothing converted to talk about yet
    });
});

describe('trip tagging', () => {
    const trips = [{ id: 'g1', kind: 'trip', name: 'Lisbon', startsOn: '2026-11-05', endsOn: '2026-11-09', isActive: true }];
    it('skips recurring bills and planned items', () => {
        expect(eligibleForAutoTrip({ recurringData: { isActive: true } })).toBe(false);
        expect(eligibleForAutoTrip({ planned: true })).toBe(false);
        expect(eligibleForAutoTrip({})).toBe(true);
    });
    it('a scan whose purchase date is outside the trip is not tagged, one inside is', () => {
        const today = new Date('2026-11-07T10:00:00');
        expect(tripForDate(trips, '2026-10-02', today)).toBeNull(); // late scan of an October receipt
        expect(tripForDate(trips, '2026-11-06', today)?.id).toBe('g1');
        expect(tripForDate(trips, '2026-11-20', today)).toBeNull();
    });
    it('today is not tagged to a trip that has not started yet', () => {
        const future = [{ id: 'g2', kind: 'trip', name: 'Later', startsOn: '2026-12-01', endsOn: '2026-12-05', isActive: true }];
        expect(tripForDate(future, '2026-11-07', new Date('2026-11-07T10:00:00'))).toBeNull();
    });
});
