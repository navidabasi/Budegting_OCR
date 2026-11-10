// PostePay / Poste Italiane / generic Italian bank export. The exact PostePay layout is still to be
// confirmed with a real export (plan: "ask the owner for one export"), so columns are detected by
// header name instead of position:
//   date:        Data operazione | Data contabile | Data valuta | Data
//   description: Descrizione operazione | Descrizione | Causale | Dettaglio
//   amount:      Importo (signed)  or  Addebiti/Dare/Uscite + Accrediti/Avere/Entrate
//   currency:    Divisa (default EUR)
// Numbers use the Italian format 1.234,56 and dates dd/mm/yyyy. Rows before the header (account
// summary lines) are skipped. Output rows have the same shape as the Revolut parser.
import { parseCsv } from '../csv';
import { cleanText, createRefBuilder, findColumn, parseAmount, parseDateString, round2 } from '../utils';

export const PROVIDER = 'postepay';

const DATE_COLS = ['data operazione', 'data contabile', 'data valuta', 'data'];
const DESC_COLS = ['descrizione operazione', 'descrizione', 'causale', 'dettaglio', 'dettagli', 'operazione'];
const CAUSALE_COLS = ['causale'];
const AMOUNT_COLS = ['importo', 'importo eur', 'importo euro'];
const DEBIT_COLS = ['addebiti', 'addebito', 'dare', 'uscite', 'uscita'];
const CREDIT_COLS = ['accrediti', 'accredito', 'avere', 'entrate', 'entrata'];
const CURRENCY_COLS = ['divisa', 'valuta importo', 'currency'];

const OWN_TRANSFER = /\bgiroconto\b|trasferimento tra (?:conti|carte) propri|giro fondi|ricarica (?:da|su) (?:conto|libretto) propri/i;

/** Find the header row: the first row that names a date column and an amount (or debit/credit) column. */
export function findHeaderRow(grid, maxScan = 40) {
    for (let i = 0; i < Math.min(grid.length, maxScan); i++) {
        const row = grid[i];
        const hasDate = findColumn(row, DATE_COLS) !== -1;
        const hasAmount = findColumn(row, AMOUNT_COLS) !== -1 || (findColumn(row, DEBIT_COLS) !== -1 && findColumn(row, CREDIT_COLS) !== -1);
        if (hasDate && hasAmount) return i;
    }
    return -1;
}

export function isPostepayLike(text) {
    const { rows } = parseCsv(text);
    return findHeaderRow(rows) !== -1;
}

/**
 * parsePostepay(csvText, { currency = 'EUR' }) -> { provider, rows, skipped: [{ line, reason }] }
 */
export async function parsePostepay(csvText, { currency = 'EUR' } = {}) {
    const { rows: grid } = parseCsv(csvText);
    const headerIndex = findHeaderRow(grid);
    if (headerIndex === -1) {
        throw new Error('Could not find the header row (expected a date column and Importo or Addebiti/Accrediti)');
    }
    const headers = grid[headerIndex];
    const iDate = findColumn(headers, DATE_COLS);
    const iDesc = findColumn(headers, DESC_COLS);
    const iCausale = findColumn(headers, CAUSALE_COLS);
    const iAmount = findColumn(headers, AMOUNT_COLS);
    const iDebit = findColumn(headers, DEBIT_COLS);
    const iCredit = findColumn(headers, CREDIT_COLS);
    const iCurrency = findColumn(headers, CURRENCY_COLS);
    // Fallback date columns when the preferred one is empty on a row.
    const dateFallbacks = DATE_COLS.map((n) => findColumn(headers, [n])).filter((i) => i !== -1);
    const ref = createRefBuilder(PROVIDER);

    const rows = [];
    const skipped = [];
    for (let r = headerIndex + 1; r < grid.length; r++) {
        const cells = grid[r];
        const line = r + 1;
        // Footer / summary lines have no date.
        let date = null;
        for (const i of [iDate, ...dateFallbacks]) {
            date = parseDateString(cells[i], 'dmy');
            if (date) break;
        }
        if (!date) {
            skipped.push({ line, reason: 'no_date' });
            continue;
        }

        let signed = null;
        if (iAmount !== -1) {
            signed = parseAmount(cells[iAmount], ',');
        } else {
            const debit = parseAmount(cells[iDebit], ',');
            const credit = parseAmount(cells[iCredit], ',');
            if (debit) signed = -Math.abs(debit);
            else if (credit) signed = Math.abs(credit);
            else if (debit === 0 || credit === 0) signed = 0;
        }
        if (signed === null) {
            skipped.push({ line, reason: 'unreadable' });
            continue;
        }
        signed = round2(signed);
        if (signed === 0) {
            skipped.push({ line, reason: 'zero' });
            continue;
        }

        const description = cleanText(iDesc !== -1 ? cells[iDesc] : '') || cleanText(iCausale !== -1 ? cells[iCausale] : '');
        const raw = {};
        headers.forEach((h, i) => {
            raw[String(h).trim() || `col${i}`] = cells[i] ?? '';
        });
        rows.push({
            date,
            description,
            amount: Math.abs(signed),
            signedAmount: signed,
            direction: signed < 0 ? 'out' : 'in',
            currency: (iCurrency !== -1 && cleanText(cells[iCurrency]).toUpperCase()) || currency,
            transactionType: OWN_TRANSFER.test(`${description} ${iCausale !== -1 ? cells[iCausale] : ''}`) ? 'transfer' : signed < 0 ? 'expense' : 'income',
            importRef: await ref(cells),
            raw,
        });
    }
    return { provider: PROVIDER, rows, skipped };
}
