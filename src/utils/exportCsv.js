/** CSV export of transactions (Settings > Data). RFC 4180 quoting; formula-looking text is neutralised for spreadsheets. */
const COLUMNS = ['date', 'type', 'merchant', 'category', 'amount', 'currency', 'account', 'to_account', 'group', 'tags', 'status', 'notes'];

export function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`; // CSV injection guard
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(transactions, accounts = []) {
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    const rows = [...transactions]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .map((tx) => {
            const status = tx.trackingData?.isTracked ? (tx.trackingData.status === 'done' ? 'paid' : 'unpaid') : '';
            return [
                String(tx.date || '').slice(0, 10),
                tx.transactionType || 'expense',
                tx.merchant,
                tx.category,
                Number(tx.total).toFixed(2),
                tx.currency,
                names.get(tx.accountId) || '',
                names.get(tx.toAccountId) || '',
                tx.groupName || '',
                (tx.groupTags || []).join(';'),
                status,
                tx.notes || '',
            ].map(csvCell).join(',');
        });
    return [COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

export function downloadCsv(filename, csv) {
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
