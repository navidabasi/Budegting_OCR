// Generic CSV importer driven by a user-supplied column mapping (fallback when no bank parser fits).
//
// mapping = {
//   date:        'Booking date' | 3            header name or 0-based column index
//   description: 'Text' | 4
//   amount:      'Amount' | 5                  signed amount, OR use debit + credit instead
//   debit?:      'Out', credit?: 'In'
//   currency?:   'Currency'                    column; otherwise options.currency
//   type?:       'Type'                        optional column; values containing transfer/giro -> transfer
//   dateFormat:  'dmy' | 'mdy' | 'ymd' | 'auto'   (default auto)
//   decimal:     ',' | '.' | 'auto'               (default auto)
//   invertSign?: true                            for statements that show spending as positive
//   headerRow?:  0-based index of the header row (default 0); hasHeader: false -> use indexes only
// }
import { parseCsv } from '../csv';
import { cleanText, createRefBuilder, findColumn, parseAmount, parseDateString, round2 } from '../utils';

export const PROVIDER = 'csv';

const TRANSFER_WORDS = /transfer|giroconto|trasferimento|exchange/i;

/** Suggest a mapping from header names (for the mapper UI to pre-fill). */
export function guessMapping(headers) {
    const pick = (names) => {
        const i = findColumn(headers, names);
        return i === -1 ? null : headers[i];
    };
    return {
        date: pick(['date', 'data', 'data operazione', 'data contabile', 'booking date', 'transaction date', 'started date', 'datum', 'fecha', 'date de l operation']),
        description: pick(['description', 'descrizione', 'descrizione operazione', 'causale', 'details', 'text', 'merchant', 'payee', 'beschreibung', 'verwendungszweck', 'libelle', 'concepto']),
        amount: pick(['amount', 'importo', 'betrag', 'montant', 'importe', 'value']),
        debit: pick(['debit', 'addebiti', 'dare', 'uscite', 'out', 'withdrawal']),
        credit: pick(['credit', 'accrediti', 'avere', 'entrate', 'in', 'deposit']),
        currency: pick(['currency', 'divisa', 'valuta', 'waehrung', 'devise']),
    };
}

const resolve = (headers, ref) => {
    if (ref === null || ref === undefined || ref === '') return -1;
    if (typeof ref === 'number') return ref;
    return findColumn(headers, [ref]);
};

/**
 * parseGeneric(csvText, mapping, { currency = 'EUR', provider = 'csv' })
 *   -> { provider, rows, skipped: [{ line, reason }] }   (same row shape as the other parsers)
 */
export async function parseGeneric(csvText, mapping = {}, { currency = 'EUR', provider = PROVIDER } = {}) {
    const { rows: grid } = parseCsv(csvText);
    const hasHeader = mapping.hasHeader !== false;
    const headerRow = mapping.headerRow ?? 0;
    const headers = hasHeader ? grid[headerRow] || [] : [];
    const start = hasHeader ? headerRow + 1 : 0;

    const iDate = resolve(headers, mapping.date);
    const iDesc = resolve(headers, mapping.description);
    const iAmount = resolve(headers, mapping.amount);
    const iDebit = resolve(headers, mapping.debit);
    const iCredit = resolve(headers, mapping.credit);
    const iCurrency = resolve(headers, mapping.currency);
    const iType = resolve(headers, mapping.type);
    if (iDate === -1) throw new Error('Mapping error: date column not found');
    if (iAmount === -1 && (iDebit === -1 || iCredit === -1)) throw new Error('Mapping error: amount (or debit + credit) column not found');

    const decimal = mapping.decimal || 'auto';
    const ref = createRefBuilder(provider);
    const rows = [];
    const skipped = [];

    for (let r = start; r < grid.length; r++) {
        const cells = grid[r];
        const line = r + 1;
        const date = parseDateString(cells[iDate], mapping.dateFormat || 'auto');
        if (!date) {
            skipped.push({ line, reason: 'no_date' });
            continue;
        }
        let signed;
        if (iAmount !== -1) {
            signed = parseAmount(cells[iAmount], decimal);
        } else {
            const debit = parseAmount(cells[iDebit], decimal);
            const credit = parseAmount(cells[iCredit], decimal);
            signed = debit ? -Math.abs(debit) : credit ? Math.abs(credit) : debit === 0 || credit === 0 ? 0 : null;
        }
        if (signed === null) {
            skipped.push({ line, reason: 'unreadable' });
            continue;
        }
        if (mapping.invertSign) signed = -signed;
        signed = round2(signed);
        if (signed === 0) {
            skipped.push({ line, reason: 'zero' });
            continue;
        }
        const description = cleanText(iDesc !== -1 ? cells[iDesc] : '');
        const raw = {};
        cells.forEach((c, i) => {
            raw[hasHeader ? String(headers[i] ?? `col${i}`) : `col${i}`] = c;
        });
        rows.push({
            date,
            description,
            amount: Math.abs(signed),
            signedAmount: signed,
            direction: signed < 0 ? 'out' : 'in',
            currency: (iCurrency !== -1 && cleanText(cells[iCurrency]).toUpperCase()) || currency,
            transactionType: iType !== -1 && TRANSFER_WORDS.test(cells[iType] || '') ? 'transfer' : signed < 0 ? 'expense' : 'income',
            importRef: await ref(cells),
            raw,
        });
    }
    return { provider, rows, skipped };
}
