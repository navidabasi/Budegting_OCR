#!/usr/bin/env node
// Per-field accuracy of /api/extract-receipt over the owner's test set. NOT run by `npm test`.
//
//   EVAL_JWT=<supabase access token> node scripts/eval-extraction.mjs [--url https://app.vercel.app/api/extract-receipt] [--dir test-receipts]
//
// test-receipts/expected.json: array (or object keyed by file name) of
//   { "file": "lidl-01.jpg", "merchant": "Lidl", "date": "2026-11-08", "total": 23.47, "itemCount": 14 }
// Images stay out of git. PDFs must be rendered to PNG first (the endpoint accepts image/* only).
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
};
const url = arg('url', process.env.EVAL_URL || 'http://localhost:3000/api/extract-receipt');
const dir = arg('dir', 'test-receipts');
const jwt = process.env.EVAL_JWT;
if (!jwt) {
    console.error('Set EVAL_JWT to a Supabase access token (browser: supabase.auth.getSession()).');
    process.exit(1);
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export const checks = {
    merchant: (exp, got) => exp.merchant != null && norm(got.merchant) !== '' && (norm(got.merchant).includes(norm(exp.merchant)) || norm(exp.merchant).includes(norm(got.merchant))),
    date: (exp, got) => exp.date != null && got.date === exp.date,
    total: (exp, got) => exp.total != null && got.total != null && Math.abs(got.total - exp.total) <= 0.01,
    items: (exp, got) => exp.itemCount != null && Math.abs((got.items?.length ?? 0) - exp.itemCount) <= Math.max(1, Math.round(exp.itemCount * 0.1)),
};

async function main() {
    const raw = JSON.parse(await readFile(join(dir, 'expected.json'), 'utf8'));
    const entries = Array.isArray(raw) ? raw : Object.entries(raw).map(([file, v]) => ({ file, ...v }));
    const stats = Object.fromEntries(Object.keys(checks).map((k) => [k, { ok: 0, n: 0 }]));
    const rows = [];

    for (const exp of entries) {
        const mime = MIME[extname(exp.file).toLowerCase()];
        if (!mime) {
            rows.push({ file: exp.file, note: 'skipped (not an image)' });
            continue;
        }
        const file = (await readFile(join(dir, exp.file))).toString('base64');
        const started = Date.now();
        let row = { file: exp.file };
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
                body: JSON.stringify({ file, mime, hints: { defaultCurrency: 'EUR', language: 'it' } }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(`${res.status} ${json.error || ''}`);
            const got = json.receipt;
            for (const [field, check] of Object.entries(checks)) {
                const expectedKey = field === 'items' ? 'itemCount' : field;
                if (exp[expectedKey] == null) continue;
                const ok = check(exp, got);
                stats[field].n += 1;
                if (ok) stats[field].ok += 1;
                row[field] = ok ? 'ok' : `X (${field === 'items' ? got.items?.length : got[field]})`;
            }
            row.ms = Date.now() - started;
        } catch (err) {
            row.note = `ERROR ${err.message}`;
        }
        rows.push(row);
    }

    console.table(rows);
    const summary = {};
    for (const [field, { ok, n }] of Object.entries(stats)) {
        summary[field] = { correct: ok, total: n, accuracy: n ? `${((ok / n) * 100).toFixed(0)}%` : 'n/a' };
    }
    console.table(summary);
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
