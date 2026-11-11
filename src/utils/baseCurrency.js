// The user's base (reporting) currency and what "not converted yet" means (pass 2 part 2, section 9). Pure; the app shell registers
// the base currency from the settings so the money functions need no extra parameter.
let base = 'EUR';
export const setBaseCurrency = (currency) => {
    base = typeof currency === 'string' && currency ? currency : 'EUR';
};
export const getBaseCurrency = () => base;

const asNumber = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * A foreign-currency record whose base-currency amount is not known (saved offline without a rate). It is never counted 1:1:
 * totals leave it out and say how many are missing, until a rate or the amount actually charged is known.
 */
export const isUnconverted = (tx) => !!tx && (tx.amountBase === null || tx.amountBase === undefined) && !!tx.currency && tx.currency !== base && asNumber(tx.total) !== 0;
