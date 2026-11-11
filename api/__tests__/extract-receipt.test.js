// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_lib/llm.js', async (importOriginal) => ({
    ...(await importOriginal()),
    chat: vi.fn(),
    hasVisionModel: vi.fn(),
}));
vi.mock('../_lib/auth.js', () => ({ requireUser: vi.fn() }));
vi.mock('../_lib/ratelimit.js', () => ({ consume: vi.fn(), recordTokens: vi.fn() }));
vi.mock('../_lib/ocr.js', () => ({ ocrImage: vi.fn() }));

import handler, { buildSystemPrompt } from '../extract-receipt.js';
import { chat, hasVisionModel, NoVisionModelError } from '../_lib/llm.js';
import { requireUser } from '../_lib/auth.js';
import { consume } from '../_lib/ratelimit.js';
import { ocrImage } from '../_lib/ocr.js';
import { HttpError } from '../_lib/http.js';
import { normalizeReceipt, deriveConfidence, receiptSchema, toNumber } from '../_lib/receiptSchema.js';
import { fakeReq, fakeRes } from '../_lib/__tests__/testUtils.js';

const B64 = Buffer.from('fake-image-bytes-for-test').toString('base64');
const GOOD = {
    merchant: 'Lidl',
    merchantRaw: 'LIDL ITALIA S.R.L.',
    date: '2026-11-08',
    time: '18:42',
    total: 23.47,
    currency: 'EUR',
    paymentMethod: 'card',
    category: 'Groceries',
    items: [
        { name: 'Latte intero 1L', quantity: 1, unitPrice: 1.19, price: 1.19, category: 'Groceries' },
        { name: 'Pasta', quantity: 2, unitPrice: 11.14, price: 22.28, category: 'Groceries' },
    ],
    tax: 2.11,
    confidence: { merchant: 0.95, date: 0.9, total: 0.98, items: 0.7 },
    notes: null,
};
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
const TODAY = new Date('2026-11-10T12:00:00Z');

beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ userId: 'u1', client: {} });
    consume.mockResolvedValue({});
});

describe('toNumber', () => {
    it.each([
        ['23,47', 23.47],
        ['1.234,56', 1234.56],
        ['1,234.56', 1234.56],
        ['€ 5.00', 5],
        [7, 7],
    ])('%s', (input, expected) => expect(toNumber(input)).toBe(expected));
    it('returns null for garbage', () => {
        expect(toNumber('abc')).toBeNull();
        expect(toNumber(undefined)).toBeNull();
        expect(toNumber(NaN)).toBeNull();
    });
});

describe('receiptSchema / normalizeReceipt', () => {
    it('accepts the documented shape', () => {
        const parsed = receiptSchema.parse(GOOD);
        expect(parsed.merchant).toBe('Lidl');
        expect(parsed.items).toHaveLength(2);
    });

    it('coerces numeric strings, unknown payment method and missing fields', () => {
        const r = normalizeReceipt(
            { merchant: ' Conad ', date: '2026-11-08', total: '12,50', currency: 'eur', paymentMethod: 'bancomat', category: 'groceries', items: [{ name: 'x', price: '1,00' }, { name: '' }, null] },
            { today: TODAY }
        );
        expect(r.merchant).toBe('Conad');
        expect(r.total).toBe(12.5);
        expect(r.currency).toBe('EUR');
        expect(r.paymentMethod).toBe('unknown');
        expect(r.category).toBe('Groceries');
        expect(r.items).toEqual([{ rawText: null, name: 'x', quantity: 1, unit: null, packSize: null, unitPrice: null, price: 1, discount: null, taxRate: null, category: null, subcategory: null }]);
    });

    it('keeps printed quantity, unit, unit price, discount and tax; subcategories only from the allowed grocery list', () => {
        const r = normalizeReceipt(
            {
                ...GOOD,
                items: [
                    { rawText: 'BANANE 0,812 KG', name: 'Banane', quantity: 0.812, unit: 'KG', unitPrice: '1,59', price: '1,29', discount: '-0,20', taxRate: 4, category: 'groceries', subcategory: 'Produce' },
                    { name: 'Acqua 6x1,5L', quantity: 1, unit: 'bottles', packSize: '6x1,5L', price: 2.4, category: 'Groceries', subcategory: 'drinks' },
                    { name: 'Batterie', price: 5, category: 'Shopping', subcategory: 'produce' },
                    { name: 'Latte', price: 1.2, unit: 'lt', taxRate: 400 },
                ],
            },
            { today: TODAY }
        );
        expect(r.items[0]).toMatchObject({ rawText: 'BANANE 0,812 KG', unit: 'kg', unitPrice: 1.59, price: 1.29, discount: 0.2, taxRate: 4, category: 'Groceries', subcategory: 'produce' });
        expect(r.items[1]).toMatchObject({ unit: null, packSize: '6x1,5L', subcategory: null }); // 'bottles' is not a unit, 'drinks' is not a subcategory key
        expect(r.items[2].subcategory).toBeNull(); // subcategories belong to groceries
        expect(r.items[3]).toMatchObject({ unit: 'l', taxRate: null }); // alias normalised, absurd tax dropped
    });

    it('never invents: absent optional fields stay null', () => {
        const r = normalizeReceipt({ ...GOOD, items: [{ name: 'Pane', price: 2 }] }, { today: TODAY });
        expect(r.items[0]).toMatchObject({ rawText: null, unit: null, packSize: null, unitPrice: null, discount: null, taxRate: null, subcategory: null });
    });

    it('the extraction prompt asks for rawText, units and subcategories and forbids inventing them', async () => {
        const { buildSystemPrompt } = await import('../extract-receipt.js');
        const p = buildSystemPrompt({ categories: ['Groceries', 'Other'] });
        for (const needle of ['rawText', 'unitPrice', 'discount', 'taxRate', 'packSize', 'subcategory', 'produce, dairy, meat_fish, pantry, snacks, beverages, frozen, bakery, other']) expect(p).toContain(needle);
        expect(p).toMatch(/ONLY when they are printed/);
        expect(p).not.toMatch(/\{\{\w+\}\}/); // every placeholder is filled
    });

    it('restricts categories to the provided list and falls back to Other', () => {
        const r = normalizeReceipt({ ...GOOD, category: 'Spaceships', items: [{ name: 'a', price: 1, category: 'Dining' }] }, { categories: ['Groceries', 'Other'], today: TODAY });
        expect(r.category).toBe('Other');
        expect(r.items[0].category).toBe('Other');
    });

    it('uses the default currency when none is printed and nulls invalid dates', () => {
        const r = normalizeReceipt({ ...GOOD, currency: null, date: '2026-13-45' }, { defaultCurrency: 'GBP', today: TODAY });
        expect(r.currency).toBe('GBP');
        expect(r.date).toBeNull();
        expect(r.confidence.date).toBe(0);
    });

    it('rejects non-objects', () => {
        expect(() => normalizeReceipt('nope')).toThrow();
    });
});

describe('deriveConfidence', () => {
    const base = { ...GOOD, items: [{ price: 10 }, { price: 13.47 }] };

    it('keeps confidence when items sum to the total', () => {
        const c = deriveConfidence(base, { today: TODAY });
        expect(c.total).toBe(0.98);
        expect(c.date).toBe(0.9);
    });

    it('allows up to 2 % difference', () => {
        const c = deriveConfidence({ ...base, total: 23.9 }, { today: TODAY }); // diff 0.43 < 0.478
        expect(c.total).toBe(0.98);
    });

    it('caps total at 0.5 when items differ from the total by more than 2 %', () => {
        const c = deriveConfidence({ ...base, total: 30 }, { today: TODAY });
        expect(c.total).toBe(0.5);
    });

    it('does not raise a lower total confidence', () => {
        const c = deriveConfidence({ ...base, total: 30, confidence: { ...GOOD.confidence, total: 0.3 } }, { today: TODAY });
        expect(c.total).toBe(0.3);
    });

    it('zeroes the date when in the future or older than 2 years', () => {
        expect(deriveConfidence({ ...base, date: '2026-11-11' }, { today: TODAY }).date).toBe(0);
        expect(deriveConfidence({ ...base, date: '2026-11-10' }, { today: TODAY }).date).toBe(0.9);
        expect(deriveConfidence({ ...base, date: '2024-11-09' }, { today: TODAY }).date).toBe(0);
        expect(deriveConfidence({ ...base, date: '2024-11-11' }, { today: TODAY }).date).toBe(0.9);
        expect(deriveConfidence({ ...base, date: null }, { today: TODAY }).date).toBe(0);
    });

    it('zeroes merchant/total/items when missing', () => {
        const c = deriveConfidence({ ...GOOD, merchant: null, total: null, items: [] }, { today: TODAY });
        expect(c).toMatchObject({ merchant: 0, total: 0, items: 0 });
    });

    it('clamps out-of-range values', () => {
        const c = deriveConfidence({ ...base, confidence: { merchant: 4, date: -1, total: 0.7, items: 0.7 } }, { today: TODAY });
        expect(c.merchant).toBe(1);
        expect(c.date).toBe(0);
    });
});

describe('buildSystemPrompt', () => {
    it('fills placeholders and covers the plan rules', () => {
        const p = buildSystemPrompt({ language: 'it', defaultCurrency: 'eur', categories: ['Groceries', 'Other'], knownMerchants: ['Lidl'] }, TODAY);
        expect(p).not.toMatch(/\{\{/);
        expect(p).toContain('2026-11-10');
        expect(p).toContain('Groceries, Other');
        expect(p).toContain('Lidl');
        for (const needle of ['Italian', 'German', 'French', 'Spanish', 'Dutch', 'legal company name', 'YYYY-MM-DD', 'decimal point', 'RESTO', 'confidence', 'json']) {
            expect(p).toContain(needle);
        }
    });
});

describe('handler', () => {
    const post = (body, headers = {}) => {
        const res = fakeRes();
        return handler(fakeReq({ body, headers }), res).then(() => res);
    };

    it('401 propagates from auth', async () => {
        requireUser.mockRejectedValue(new HttpError(401, 'Missing bearer token'));
        const res = await post({ file: B64, mime: 'image/jpeg' });
        expect(res.statusCode).toBe(401);
        expect(consume).not.toHaveBeenCalled();
    });

    it('429 propagates from the rate limiter and no model is called', async () => {
        consume.mockRejectedValue(new HttpError(429, 'limit'));
        hasVisionModel.mockReturnValue(true);
        const res = await post({ file: B64, mime: 'image/jpeg' });
        expect(res.statusCode).toBe(429);
        expect(chat).not.toHaveBeenCalled();
    });

    it('rejects PDFs and bad input', async () => {
        expect((await post({ file: B64, mime: 'application/pdf' })).statusCode).toBe(415);
        expect((await post({ mime: 'image/png' })).statusCode).toBe(400);
        expect((await post({ file: '!!!notbase64!!!notbase64', mime: 'image/png' })).statusCode).toBe(400);
        expect((await post({ file: B64, mime: 'image/png', hints: { knownMerchants: Array(51).fill('x') } })).statusCode).toBe(400);
    });

    it('uses the vision model when configured', async () => {
        hasVisionModel.mockReturnValue(true);
        chat.mockResolvedValue({ data: GOOD, usage, model: 'gemini', durationMs: 5 });
        const res = await post({ file: B64, mime: 'image/jpeg', hints: { knownMerchants: ['Lidl'] } });
        expect(res.statusCode).toBe(200);
        expect(res.body.receipt.merchant).toBe('Lidl');
        expect(res.body.receipt.total).toBe(23.47);
        expect(res.body.extraction).toMatchObject({ provider: 'vision', model: 'gemini' });
        expect(ocrImage).not.toHaveBeenCalled();
        const args = chat.mock.calls[0][0];
        expect(args.vision).toBe(true);
        expect(args.json).toBe(true);
        expect(args.images[0].base64).toBe(B64);
        expect(args.messages[0].content).toContain('Lidl');
    });

    it('falls back to OCR text + text model without a vision model', async () => {
        hasVisionModel.mockReturnValue(false);
        ocrImage.mockResolvedValue({ text: 'LIDL\nTOTALE 23,47' });
        chat.mockResolvedValue({ data: GOOD, usage, model: 'deepseek-chat', durationMs: 5 });
        const res = await post({ file: B64, mime: 'image/png' });
        expect(res.statusCode).toBe(200);
        expect(res.body.extraction.provider).toBe('ocr+text');
        expect(res.body.extraction.rawText).toContain('LIDL');
        expect(chat.mock.calls[0][0].vision).toBeUndefined();
        expect(chat.mock.calls[0][0].messages[1].content).toContain('TOTALE 23,47');
    });

    it('falls back to OCR when the vision call reports no vision model', async () => {
        hasVisionModel.mockReturnValue(true);
        ocrImage.mockResolvedValue({ text: 'TEXT' });
        chat.mockRejectedValueOnce(new NoVisionModelError()).mockResolvedValueOnce({ data: GOOD, usage, model: 'm', durationMs: 1 });
        const res = await post({ file: B64, mime: 'image/png' });
        expect(res.statusCode).toBe(200);
        expect(res.body.extraction.provider).toBe('ocr+text');
    });

    it('422 when OCR finds no text', async () => {
        hasVisionModel.mockReturnValue(false);
        ocrImage.mockResolvedValue({ text: '' });
        expect((await post({ file: B64, mime: 'image/png' })).statusCode).toBe(422);
    });

    it('502 when the model output is unusable', async () => {
        hasVisionModel.mockReturnValue(true);
        chat.mockResolvedValue({ data: 'just text', usage, model: 'm', durationMs: 1 });
        expect((await post({ file: B64, mime: 'image/png' })).statusCode).toBe(502);
    });

    it('applies derived confidence in the response', async () => {
        hasVisionModel.mockReturnValue(true);
        chat.mockResolvedValue({ data: { ...GOOD, total: 99 }, usage, model: 'm', durationMs: 1 });
        const res = await post({ file: B64, mime: 'image/png' });
        expect(res.body.receipt.confidence.total).toBeLessThanOrEqual(0.5);
    });

    it('405 for GET', async () => {
        const res = fakeRes();
        await handler(fakeReq({ method: 'GET' }), res);
        expect(res.statusCode).toBe(405);
    });
});
