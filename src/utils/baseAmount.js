// Base-currency amounts stored at write time (plan P4-T2). Pure.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * computeBase({ total, currency, baseCurrency, rate })
 * -> { amountBase, baseCurrency, exchangeRate }. Same currency: rate 1. No rate (offline, no cache): all null,
 * and the transaction keeps showing/summing its own total until a later pass fills it in.
 */
export function computeBase({ total, currency, baseCurrency, rate }) {
    const t = Number(total);
    if (!Number.isFinite(t) || !baseCurrency) return { amountBase: null, baseCurrency: null, exchangeRate: null };
    if (!currency || currency === baseCurrency) return { amountBase: round2(t), baseCurrency, exchangeRate: 1 };
    if (!Number.isFinite(rate) || rate <= 0) return { amountBase: null, baseCurrency: null, exchangeRate: null };
    return { amountBase: round2(t * rate), baseCurrency, exchangeRate: Math.round(rate * 1e6) / 1e6 };
}

/** Does this stored row still need a base amount? Same-currency rows are fine without one (fullAmount falls back to total). */
export const needsBase = (tx, baseCurrency) => !!tx && (tx.amountBase === null || tx.amountBase === undefined) && !!tx.currency && tx.currency !== baseCurrency && Number(tx.total) > 0;
