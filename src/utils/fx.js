// Foreign-currency conversion provenance (pass 2 part 2, section 9). Pure.
//
// A foreign receipt keeps what was paid (total + currency) and, next to it, the base-currency amount with where it came from:
//   confirmed  the amount actually charged in the base currency is known (bank import row, or typed from the statement)
//   estimated  converted with a daily rate (cached, fetched, or typed by hand); the rate and its date are kept
//   pending    no rate yet (saved offline): amountBase stays null and the record is NOT counted 1:1
// The provenance lives in `extraction.fx` (the receipts.extraction jsonb column that is already synced), so no schema change is
// needed. Nothing here recomputes an amount that is already stored: history is never revalued silently.
import { computeBase } from './baseAmount';
import { isUnconverted } from './baseCurrency';

export const FX_STATUS = ['confirmed', 'estimated', 'pending'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6;

export const isForeign = (tx, base = 'EUR') => !!tx && !!tx.currency && tx.currency !== base;

/** 'confirmed' | 'estimated' | 'pending' for a foreign record, null for one in the base currency. Records converted before this existed are 'estimated' (rate date unknown). */
export function fxStatus(tx, base = 'EUR') {
    if (!isForeign(tx, base)) return null;
    if (isUnconverted({ ...tx }) || tx.amountBase === null || tx.amountBase === undefined) return 'pending';
    return tx.extraction?.fx?.status === 'confirmed' ? 'confirmed' : 'estimated';
}

/** Everything the UI shows about a conversion: { status, originalAmount, originalCurrency, baseAmount, rate, date, source }. */
export function fxInfo(tx, base = 'EUR') {
    const status = fxStatus(tx, base);
    if (!status) return null;
    const fx = tx.extraction?.fx || {};
    const total = Number(tx.total) || 0;
    const baseAmount = status === 'pending' ? null : Number(tx.amountBase);
    return {
        status,
        originalAmount: total,
        originalCurrency: tx.currency,
        baseAmount,
        baseCurrency: tx.baseCurrency || base,
        rate: status === 'pending' ? null : tx.exchangeRate ?? (total ? round6(baseAmount / total) : null),
        date: fx.date || null,
        source: fx.source || (status === 'estimated' ? 'legacy' : null),
    };
}

const merge = (extraction, fx) => ({ ...(extraction && typeof extraction === 'object' ? extraction : {}), fx });

/** Patch for a record converted with a daily rate: { amountBase, baseCurrency, exchangeRate, extraction }. A missing rate gives 'pending'. */
export function estimatedPatch(tx, { baseCurrency, rate, date = null, source = 'api' }) {
    const b = computeBase({ total: tx.total, currency: tx.currency, baseCurrency, rate });
    if (b.amountBase === null) return pendingPatch(tx);
    return { ...b, extraction: merge(tx.extraction, { status: 'estimated', rate: b.exchangeRate, date, source }) };
}

/** Patch for a record whose base amount actually charged is known. The rate is derived from it. */
export function confirmedPatch(tx, { baseCurrency, charged, date = null, source = 'charged' }) {
    const total = Number(tx.total);
    const amount = round2(charged);
    if (!(amount > 0) || !(total > 0)) return null;
    const rate = round6(amount / total);
    return { amountBase: amount, baseCurrency, exchangeRate: rate, extraction: merge(tx.extraction, { status: 'confirmed', rate, date, source }) };
}

/** Patch for a record with no rate yet. */
export function pendingPatch(tx) {
    return { amountBase: null, baseCurrency: null, exchangeRate: null, extraction: merge(tx.extraction, { status: 'pending' }) };
}

/** Does this stored conversion hold the actual charge (it must survive recalculation)? */
export const isConfirmed = (tx) => tx?.extraction?.fx?.status === 'confirmed';
