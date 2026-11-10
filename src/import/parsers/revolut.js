// Revolut CSV export:
//   Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance
// Output rows: { date, description, amount (>= 0), signedAmount, direction: 'in'|'out', currency,
//                transactionType: 'expense'|'income'|'transfer', importRef, raw }
// `amount` is positive; the sign lives in `direction`/`signedAmount`. The fee is folded in (a 10.00
// card payment with a 0.50 fee becomes a 10.50 expense).
import { parseCsv, toRecords } from '../csv';
import { cleanText, createRefBuilder, findColumn, parseAmount, parseDateString, round2 } from '../utils';

export const PROVIDER = 'revolut';

const SKIP_STATES = new Set(['REVERTED', 'DECLINED', 'FAILED', 'PENDING']);
const REQUIRED = ['type', 'started date', 'description', 'amount', 'currency', 'state'];

// Descriptions that mean "between my own pockets / vaults / accounts".
const OWN_POCKET = /\b(pocket|vault|savings|salvadanaio|risparmi|accantonamento|tasca|spare change|round[- ]?up|to (?:your )?(?:eur|usd|gbp|chf)\b|from (?:your )?(?:eur|usd|gbp|chf)\b)/i;

export function isRevolutHeader(headers) {
    const cols = headers.map((h) => String(h).trim().toLowerCase());
    return REQUIRED.every((r) => cols.includes(r));
}

function classify(type, description, signed) {
    const t = String(type || '').toUpperCase();
    if (t === 'EXCHANGE' || t === 'TOPUP') return 'transfer';
    if (t === 'TRANSFER') return OWN_POCKET.test(description) ? 'transfer' : signed < 0 ? 'expense' : 'income';
    return signed < 0 ? 'expense' : 'income'; // CARD_PAYMENT, CARD_REFUND, ATM, FEE, REWARD, TAX...
}

/**
 * parseRevolut(csvText) -> { provider, rows, skipped: [{ line, reason }] }
 * Skipped: REVERTED / DECLINED / FAILED (and PENDING, which reappears as COMPLETED), zero amounts,
 * rows that cannot be read.
 */
export async function parseRevolut(csvText) {
    const { rows: grid } = parseCsv(csvText);
    if (grid.length === 0) return { provider: PROVIDER, rows: [], skipped: [] };
    const { headers, records } = toRecords(grid, 0);
    if (!isRevolutHeader(headers)) {
        throw new Error('Not a Revolut export: expected columns Type, Started Date, Description, Amount, Currency, State');
    }
    const col = (name) => headers[findColumn(headers, [name])];
    const get = (rec, name) => (col(name) === undefined ? '' : rec[col(name)]);
    const ref = createRefBuilder(PROVIDER);

    const rows = [];
    const skipped = [];
    for (const { record, cells, line } of records) {
        const state = String(get(record, 'State')).trim().toUpperCase();
        if (SKIP_STATES.has(state)) {
            skipped.push({ line, reason: state.toLowerCase() });
            continue;
        }
        const amount = parseAmount(get(record, 'Amount'), '.');
        const fee = parseAmount(get(record, 'Fee'), '.') || 0;
        const date = parseDateString(get(record, 'Started Date') || get(record, 'Completed Date'), 'ymd');
        if (amount === null || !date) {
            skipped.push({ line, reason: 'unreadable' });
            continue;
        }
        const signed = round2(amount - fee);
        if (signed === 0) {
            skipped.push({ line, reason: 'zero' });
            continue;
        }
        const description = cleanText(get(record, 'Description'));
        rows.push({
            date,
            description,
            amount: Math.abs(signed),
            signedAmount: signed,
            direction: signed < 0 ? 'out' : 'in',
            currency: cleanText(get(record, 'Currency')).toUpperCase() || 'EUR',
            transactionType: classify(get(record, 'Type'), description, signed),
            importRef: await ref(cells),
            raw: record,
        });
    }
    return { provider: PROVIDER, rows, skipped };
}
