import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScanError, buildHints, extractReceipt, initialScanState, isUnreadable, lowConfidenceFields, parseExtractResponse, scanReducer } from '../receiptScan';

const GOOD = {
    receipt: {
        merchant: 'Lidl', merchantRaw: 'LIDL ITALIA S.R.L.', date: '2026-11-08', time: '18:42', total: 23.47, currency: 'EUR', paymentMethod: 'card', category: 'Groceries',
        items: [{ name: 'Latte intero 1L', quantity: 1, unitPrice: 1.19, price: 1.19, category: 'Groceries' }, { name: '', price: null }],
        tax: 2.11, confidence: { merchant: 0.95, date: 0.9, total: 0.4, items: 0.7 }, notes: null,
    },
    extraction: { provider: 'vision', model: 'gemini', durationMs: 1200 },
};
const file = () => new File([new Uint8Array([1, 2, 3, 4])], 'r.jpg', { type: 'image/jpeg' });
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const run = (fetchImpl, extra = {}) => extractReceipt({ file: file(), hints: { language: 'en' }, getToken: async () => 'tok', fetchImpl, ...extra });
const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
afterEach(() => setOnline(true));

describe('extractReceipt (mocked fetch)', () => {
    it('POSTs { file, mime, hints } with a bearer token and parses { receipt, extraction }', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(res(200, GOOD));
        const out = await run(fetchImpl);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('/api/extract-receipt');
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer tok');
        const body = JSON.parse(init.body);
        expect(body.mime).toBe('image/jpeg');
        expect(body.hints).toEqual({ language: 'en' });
        expect(body.file).toBe('AQIDBA==');
        expect(out.receipt.merchant).toBe('Lidl');
        expect(out.receipt.items).toHaveLength(1); // the empty line without price is dropped
        expect(out.extraction.provider).toBe('vision');
    });

    it.each([
        [404, 'unavailable'], [405, 'unavailable'], [429, 'rateLimit'], [500, 'server'], [502, 'server'], [401, 'auth'], [422, 'invalid'], [413, 'invalid'],
    ])('maps HTTP %i to error kind %s', async (status, kind) => {
        await expect(run(vi.fn().mockResolvedValue(res(status, {})))).rejects.toMatchObject({ kind });
    });

    it('is offline without calling fetch', async () => {
        setOnline(false);
        const fetchImpl = vi.fn();
        await expect(run(fetchImpl)).rejects.toMatchObject({ kind: 'offline' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('maps network failures and unusable bodies', async () => {
        await expect(run(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).rejects.toMatchObject({ kind: 'network' });
        await expect(run(vi.fn().mockResolvedValue(res(200, { nope: 1 })))).rejects.toMatchObject({ kind: 'invalid' });
    });

    it('requires a signed-in user', async () => {
        await expect(run(vi.fn(), { getToken: async () => null })).rejects.toBeInstanceOf(ScanError);
    });
});

describe('response helpers', () => {
    it('flags fields under 0.7 confidence or missing', () => {
        const { receipt } = parseExtractResponse(GOOD);
        expect(lowConfidenceFields(receipt)).toEqual({ merchant: false, date: false, total: true });
        expect(lowConfidenceFields({ ...receipt, merchant: null }).merchant).toBe(true);
        expect(lowConfidenceFields({ ...receipt, confidence: { merchant: null, date: null, total: null } })).toEqual({ merchant: false, date: false, total: false });
    });
    it('detects unreadable item lines', () => {
        expect(isUnreadable({ name: 'x', price: 1 })).toBe(false);
        expect(isUnreadable({ name: '', price: 1 })).toBe(true);
        expect(isUnreadable({ name: 'x', price: null })).toBe(true);
    });
    it('builds hints: most frequent merchants first, max 50, no Income/Transfer categories', () => {
        const tx = [{ merchant: 'Lidl' }, { merchant: 'lidl' }, { merchant: 'Conad' }, { merchant: 'Demo', isDemo: true }, { merchant: 'X', extraction: { pending: true } }];
        const h = buildHints({ languageCode: 'it', defaultCurrency: 'EUR', categories: ['Groceries', 'Income', 'Transfer'], transactions: tx, accounts: [{ name: 'Revolut' }] });
        expect(h).toEqual({ language: 'it', defaultCurrency: 'EUR', categories: ['Groceries'], knownMerchants: ['Lidl', 'Conad'], accounts: ['Revolut'] });
    });
});

describe('scan state machine', () => {
    const f = new File(['x'], 'a.jpg');
    it('happy path: idle -> preparing -> extracting -> review', () => {
        let s = scanReducer(initialScanState, { type: 'PICK', file: f });
        expect(s.phase).toBe('preparing');
        s = scanReducer(s, { type: 'PREPARED', file: f });
        expect(s.phase).toBe('extracting');
        s = scanReducer(s, { type: 'EXTRACTED', result: { receipt: {} } });
        expect(s.phase).toBe('review');
    });
    it('error path with retry, rescan resets', () => {
        let s = scanReducer(scanReducer(initialScanState, { type: 'PICK', file: f }), { type: 'PREPARED', file: f });
        s = scanReducer(s, { type: 'FAILED', kind: 'server' });
        expect(s).toMatchObject({ phase: 'error', error: 'server' });
        s = scanReducer(s, { type: 'RETRY' });
        expect(s.phase).toBe('extracting');
        s = scanReducer(s, { type: 'QUEUED' });
        expect(s.phase).toBe('queued');
        expect(scanReducer(s, { type: 'RESCAN' })).toEqual(initialScanState);
    });
    it('ignores out-of-order events', () => {
        expect(scanReducer(initialScanState, { type: 'EXTRACTED', result: {} })).toBe(initialScanState);
        expect(scanReducer(initialScanState, { type: 'FAILED', kind: 'server' })).toBe(initialScanState);
    });
});

describe('scan draft restore', () => {
    it('RESTORE goes back to review with the saved result, or to extraction when the photo never got that far', async () => {
        const { scanReducer, initialScanState } = await import('../receiptScan');
        const file = new Blob(['x']);
        const result = { receipt: { merchant: 'Lidl' }, extraction: {} };
        expect(scanReducer(initialScanState, { type: 'RESTORE', file, result })).toMatchObject({ phase: 'review', file, result });
        expect(scanReducer(initialScanState, { type: 'RESTORE', file })).toMatchObject({ phase: 'extracting', file, result: null });
    });
});
