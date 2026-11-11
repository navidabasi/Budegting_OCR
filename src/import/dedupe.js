// Match imported bank rows against existing transactions (plan P4-T6): same amount within 0.01 and
// date within 1 day, preferring a merchantKey match. Also detects exact re-imports through importRef.
import { merchantKey } from '../utils/merchant';
import { daysBetween } from '../utils/monthMath';

const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
};

const typeOf = (t) => t?.transactionType || 'expense';

const firstToken = (key) => key.split(' ')[0] || '';

function merchantScore(importedKey, existingKey) {
    if (!importedKey || !existingKey) return 0;
    if (importedKey === existingKey) return 10;
    const a = firstToken(importedKey);
    const b = firstToken(existingKey);
    if (a.length >= 4 && a === b) return 6;
    if (importedKey.includes(existingKey) || existingKey.includes(importedKey)) return existingKey.length >= 4 && importedKey.length >= 4 ? 4 : 0;
    return 0;
}

/**
 * findDuplicates(imported, existing, { amountTolerance = 0.01, maxDays = 1 })
 *   imported: parser rows { date, description, amount, transactionType, importRef }
 *   existing: transactions { id, date, total, amountBase, merchant, merchantKey, transactionType, importRef }
 * -> [{ imported, importedIndex, existing, reason: 'import_ref'|'match', score, merchantMatch, daysApart }]
 *
 * Each existing transaction is paired at most once and each imported row at most once (best score first).
 * An existing transaction that already carries a different importRef came from another bank row and is
 * never a candidate. Expense/income/transfer must agree.
 */
export function findDuplicates(imported = [], existing = [], { amountTolerance = 0.01, maxDays = 1 } = {}) {
    const candidates = [];
    const existingKeys = existing.map((e) => e.merchantKey || merchantKey(e.merchant));
    const importedKeys = imported.map((row) => merchantKey(row.description || row.merchant));

    imported.forEach((row, i) => {
        const amount = num(row.amount);
        existing.forEach((e, j) => {
            if (row.importRef && e.importRef === row.importRef) {
                candidates.push({ i, j, score: 1000, reason: 'import_ref', daysApart: 0, merchantMatch: false });
                return;
            }
            if (e.importRef) return;
            if (typeOf(e) !== typeOf(row)) return;
            if (amount === null) return;
            // A purchase in a foreign currency against a bank row in the account currency: the bank amount is what was actually
            // charged. Needs a clear merchant match, a date within 2 days and (when a rate was applied) an amount in the same ballpark.
            if (e.currency && row.currency && e.currency !== row.currency) {
                const fxDays = Math.abs(daysBetween(e.date, row.date));
                const fxMerchant = merchantScore(importedKeys[i], existingKeys[j]);
                if (!e.date || !row.date || fxDays > 2 || fxMerchant < 6) return;
                const estimate = num(e.amountBase);
                if (estimate !== null && Math.abs(Math.abs(estimate) - Math.abs(amount)) > Math.max(1, 0.05 * Math.abs(estimate))) return;
                candidates.push({ i, j, score: 80 + fxMerchant * 10 - fxDays * 5, reason: 'fx_match', daysApart: fxDays, merchantMatch: true });
                return;
            }
            const amounts = [num(e.amountBase), num(e.total)].filter((v) => v !== null).map(Math.abs);
            const amountDiff = Math.min(...amounts.map((a) => Math.abs(a - Math.abs(amount))), Infinity);
            if (amountDiff > amountTolerance + 1e-9) return;
            const days = Math.abs(daysBetween(e.date, row.date));
            if (!e.date || !row.date || days > maxDays) return;
            const m = merchantScore(importedKeys[i], existingKeys[j]);
            candidates.push({ i, j, score: 100 + m * 10 - days * 5 - amountDiff * 100, reason: 'match', daysApart: days, merchantMatch: m > 0 });
        });
    });

    candidates.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
    const usedImported = new Set();
    const usedExisting = new Set();
    const pairs = [];
    for (const c of candidates) {
        if (usedImported.has(c.i) || usedExisting.has(c.j)) continue;
        usedImported.add(c.i);
        usedExisting.add(c.j);
        pairs.push({
            imported: imported[c.i],
            importedIndex: c.i,
            existing: existing[c.j],
            reason: c.reason,
            score: Math.round(c.score * 100) / 100,
            merchantMatch: c.merchantMatch,
            daysApart: c.daysApart,
        });
    }
    return pairs.sort((a, b) => a.importedIndex - b.importedIndex);
}
