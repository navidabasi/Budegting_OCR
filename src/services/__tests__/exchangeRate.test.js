import { describe, it, expect, beforeEach, vi } from 'vitest';
import { __clearRateCache, getCachedRate, getRate, todayKey } from '../exchangeRateService';
import { computeBase, needsBase } from '../../utils/baseAmount';

const ok = (rates) => vi.fn(async () => ({ ok: true, json: async () => ({ rates }) }));
beforeEach(() => {
    __clearRateCache();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('exchange rate cache (per day, localStorage)', () => {
    it('fetches once per day and per currency, then serves from the cache', async () => {
        const fetchImpl = ok({ EUR: 0.9, GBP: 0.8 });
        expect(await getRate('USD', 'EUR', { fetchImpl })).toBe(0.9);
        expect(await getRate('USD', 'GBP', { fetchImpl })).toBe(0.8);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(`wmw.fx.${todayKey()}.USD`)).toContain('0.9');
        expect(getCachedRate('USD', 'EUR')).toBe(0.9);
        expect(getCachedRate('EUR', 'USD')).toBeCloseTo(1 / 0.9, 6); // inverse of a cached table
    });
    it('same currency is 1 without any request', async () => {
        const fetchImpl = vi.fn();
        expect(await getRate('EUR', 'EUR', { fetchImpl })).toBe(1);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
    it('offline with no cached rate gives null and does not touch the network', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        const fetchImpl = vi.fn();
        expect(await getRate('USD', 'EUR', { fetchImpl })).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
    });
    it('a failing request (CSP, timeout, 500) gives null', async () => {
        expect(await getRate('USD', 'EUR', { fetchImpl: vi.fn(async () => { throw new TypeError('blocked'); }) })).toBeNull();
        expect(await getRate('USD', 'EUR', { fetchImpl: vi.fn(async () => ({ ok: false })) })).toBeNull();
    });
});

describe('computeBase', () => {
    it('stores amountBase, baseCurrency and the rate', () => {
        expect(computeBase({ total: 10, currency: 'USD', baseCurrency: 'EUR', rate: 0.9 })).toEqual({ amountBase: 9, baseCurrency: 'EUR', exchangeRate: 0.9 });
        expect(computeBase({ total: 12.34, currency: 'EUR', baseCurrency: 'EUR' })).toEqual({ amountBase: 12.34, baseCurrency: 'EUR', exchangeRate: 1 });
    });
    it('is null without a rate for a foreign currency', () => {
        expect(computeBase({ total: 10, currency: 'USD', baseCurrency: 'EUR', rate: null })).toEqual({ amountBase: null, baseCurrency: null, exchangeRate: null });
    });
    it('needsBase only flags foreign rows without an amount', () => {
        expect(needsBase({ total: 5, currency: 'USD', amountBase: null }, 'EUR')).toBe(true);
        expect(needsBase({ total: 5, currency: 'EUR', amountBase: null }, 'EUR')).toBe(false);
        expect(needsBase({ total: 5, currency: 'USD', amountBase: 4 }, 'EUR')).toBe(false);
    });
});
