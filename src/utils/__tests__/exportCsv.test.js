import { describe, expect, it } from 'vitest';
import { buildCsv, csvCell } from '../exportCsv';
import { getScanPrefs, setScanPrefs } from '../scanPrefs';

describe('csv export', () => {
    it('quotes commas, quotes and newlines and guards formulas', () => {
        expect(csvCell('a,b')).toBe('"a,b"');
        expect(csvCell('say "hi"')).toBe('"say ""hi"""');
        expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
        expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
        expect(csvCell('-12.5')).toBe('-12.5');
        expect(csvCell(null)).toBe('');
    });
    it('builds rows newest first with account names and paid status', () => {
        const csv = buildCsv(
            [
                { date: '2026-11-01', merchant: 'Old', total: 5, currency: 'EUR', category: 'Other' },
                { date: '2026-11-09', transactionType: 'transfer', merchant: 'To Savings', total: 400, currency: 'EUR', accountId: 'a', toAccountId: 'b', trackingData: { isTracked: true, status: 'open' } },
            ],
            [{ id: 'a', name: 'Revolut' }, { id: 'b', name: 'Savings' }]
        );
        const lines = csv.trim().split('\r\n');
        expect(lines[0]).toBe('date,type,merchant,category,amount,currency,account,to_account,group,tags,status,notes');
        expect(lines[1]).toBe('2026-11-09,transfer,To Savings,,400.00,EUR,Revolut,Savings,,,unpaid,');
        expect(lines[2].startsWith('2026-11-01,expense,Old')).toBe(true);
    });
});

describe('scan prefs', () => {
    it('defaults on and persists', () => {
        localStorage.clear();
        expect(getScanPrefs()).toEqual({ saveImages: true, readItems: true });
        setScanPrefs({ saveImages: false });
        expect(getScanPrefs()).toEqual({ saveImages: false, readItems: true });
    });
});
