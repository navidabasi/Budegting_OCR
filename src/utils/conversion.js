// Foreign-currency conversion status (pass 2 part 2, section 9). Pure.
import { inPeriod } from './period';
import { needsBase } from './baseAmount';
import { isPlanned, typeOf } from './money';

/**
 * Transactions in the period whose EUR (base) amount is not known yet: foreign currency with no `amountBase`.
 * -> { count, byCurrency: { USD: { count, total } } }. A period of undefined/null means all time.
 */
export function pendingConversionCount(transactions = [], period, baseCurrency = 'EUR') {
    const byCurrency = {};
    let count = 0;
    for (const tx of transactions || []) {
        if (!tx || tx.isDemo || isPlanned(tx) || !['expense', 'income'].includes(typeOf(tx))) continue;
        if (period && !inPeriod(tx.date, period)) continue;
        if (!needsBase(tx, baseCurrency)) continue;
        count += 1;
        const e = (byCurrency[tx.currency] ||= { count: 0, total: 0 });
        e.count += 1;
        e.total = Math.round((e.total + Number(tx.total)) * 100) / 100;
    }
    return { count, byCurrency };
}
