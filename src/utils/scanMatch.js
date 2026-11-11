// Match a freshly scanned receipt to a transaction the user already entered by hand (pass 2, section 2 / case 2).
// A match: expense, same currency (or unknown), same amount within one cent, date within one day, not planned/unpaid and
// not already carrying a photo or a scan. Merchant agreement only ranks candidates. Pure.
import { merchantKey } from './merchant';
import { daysBetween } from './monthMath';
import { isPlanned } from './money';

const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
};

export function findManualMatches(transactions = [], { total, date, merchant, currency } = {}, { maxDays = 1, tolerance = 0.01 } = {}) {
    const amount = num(total);
    if (!(amount > 0) || !date) return [];
    const key = merchant ? merchantKey(merchant) : '';
    const out = [];
    for (const tx of transactions) {
        if (!tx || (tx.transactionType || 'expense') !== 'expense' || tx.imagePath || tx.extraction || tx.isDemo) continue;
        if (isPlanned(tx)) continue;
        if (currency && tx.currency && tx.currency !== currency) continue;
        const t = num(tx.total);
        if (t === null || Math.abs(t - amount) > tolerance) continue;
        const apart = Math.abs(daysBetween(tx.date, date));
        if (apart > maxDays) continue;
        const txKey = tx.merchantKey || (tx.merchant ? merchantKey(tx.merchant) : '');
        const merchantMatch = !!key && !!txKey && (key === txKey || key.includes(txKey) || txKey.includes(key));
        out.push({ transaction: tx, daysApart: apart, merchantMatch, score: (merchantMatch ? 10 : 0) - apart });
    }
    return out.sort((a, b) => b.score - a.score);
}
