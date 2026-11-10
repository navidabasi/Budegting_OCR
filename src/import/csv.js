// RFC 4180 CSV parser: quoted fields, "" escapes, newlines inside quotes, CRLF/LF/CR, BOM,
// delimiter auto-detection (`;`, `,`, tab). Pure.

const CANDIDATES = [',', ';', '\t'];

export function stripBom(text) {
    return typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Count delimiters per line outside quotes for the first lines; pick the most consistent one. */
export function detectDelimiter(text, sampleLines = 10) {
    const scores = new Map(CANDIDATES.map((d) => [d, []]));
    let line = new Map(CANDIDATES.map((d) => [d, 0]));
    let inQuotes = false;
    let seen = 0;
    const flush = () => {
        const nonEmpty = [...line.values()].some((v) => v > 0);
        if (nonEmpty) {
            for (const d of CANDIDATES) scores.get(d).push(line.get(d));
            seen += 1;
        }
        line = new Map(CANDIDATES.map((d) => [d, 0]));
    };
    for (let i = 0; i < text.length && seen < sampleLines; i++) {
        const ch = text[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (!inQuotes) {
            if (ch === '\n') flush();
            else if (line.has(ch)) line.set(ch, line.get(ch) + 1);
        }
    }
    if (seen < sampleLines) flush();

    let best = ',';
    let bestScore = -1;
    for (const d of CANDIDATES) {
        const counts = scores.get(d).filter((c) => c > 0);
        if (counts.length === 0) continue;
        // consistent, frequent delimiters win: lines containing it, then its typical count
        const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)];
        const score = counts.length * 1000 + mode;
        if (score > bestScore) {
            bestScore = score;
            best = d;
        }
    }
    return best;
}

/**
 * parseCsv(text, { delimiter }) -> { rows: string[][], delimiter }
 * Rows that are completely empty are dropped. A trailing newline does not create an extra row.
 */
export function parseCsv(input, { delimiter } = {}) {
    const text = stripBom(String(input ?? ''));
    const delim = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let fieldWasQuoted = false;

    const endField = () => {
        row.push(fieldWasQuoted ? field : field.trim());
        field = '';
        fieldWasQuoted = false;
    };
    const endRow = () => {
        endField();
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
            continue;
        }
        if (ch === '"' && field.trim() === '' && !fieldWasQuoted) {
            inQuotes = true;
            fieldWasQuoted = true;
            field = '';
        } else if (ch === delim) {
            endField();
        } else if (ch === '\r') {
            if (text[i + 1] === '\n') i += 1;
            endRow();
        } else if (ch === '\n') {
            endRow();
        } else if (fieldWasQuoted && /\s/.test(ch)) {
            // whitespace after a closing quote is not part of the value
        } else {
            field += ch;
        }
    }
    if (field !== '' || fieldWasQuoted || row.length > 0) endRow();
    return { rows, delimiter: delim };
}

/** First row as headers, the rest as objects keyed by header (duplicate headers get _2, _3...). */
export function toRecords(rows, headerIndex = 0) {
    const headerRow = rows[headerIndex] || [];
    const seen = new Map();
    const headers = headerRow.map((h) => {
        const base = String(h ?? '').trim();
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        return n === 1 ? base : `${base}_${n}`;
    });
    const records = rows.slice(headerIndex + 1).map((r, i) => {
        const rec = {};
        headers.forEach((h, c) => {
            rec[h] = r[c] ?? '';
        });
        return { record: rec, cells: r, line: headerIndex + 2 + i };
    });
    return { headers, records };
}
