// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ocrImage, toOcrLanguage } from '../ocr.js';

const ENV = { OCR_SPACE_API_KEY: 'ocr-key' };
const ok = (data) => ({ ok: true, status: 200, json: async () => data });

describe('toOcrLanguage', () => {
    it('maps UI languages', () => {
        expect(toOcrLanguage('it')).toBe('ita');
        expect(toOcrLanguage('de-DE')).toBe('ger');
        expect(toOcrLanguage('xx')).toBe('auto');
        expect(toOcrLanguage(undefined)).toBe('auto');
    });
});

describe('ocrImage', () => {
    it('sends engine 2, scale, detectOrientation and returns joined text', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            ok({ ParsedResults: [{ ParsedText: 'LIDL\r\nTOTALE 5,00' }, { ParsedText: 'page2' }] })
        );
        const out = await ocrImage({ base64: Buffer.from('abc').toString('base64'), mime: 'image/png', language: 'it', fetchImpl, env: ENV });
        expect(out.text).toBe('LIDL\nTOTALE 5,00\npage2');
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.ocr.space/parse/image');
        const form = init.body;
        expect(form.get('apikey')).toBe('ocr-key');
        expect(form.get('OCREngine')).toBe('2');
        expect(form.get('scale')).toBe('true');
        expect(form.get('detectOrientation')).toBe('true');
        expect(form.get('language')).toBe('ita');
        expect(form.get('file').type).toBe('image/png');
    });

    it('503 when the key is missing', async () => {
        await expect(ocrImage({ base64: 'AAAA', env: {} })).rejects.toMatchObject({ status: 503 });
    });

    it('422 when OCR.Space reports a processing error', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(ok({ IsErroredOnProcessing: true, ErrorMessage: ['bad'] }));
        await expect(ocrImage({ base64: 'AAAA', fetchImpl, env: ENV })).rejects.toMatchObject({ status: 422 });
    });

    it('maps network failure and HTTP errors', async () => {
        const net = vi.fn().mockRejectedValue(new Error('down'));
        await expect(ocrImage({ base64: 'AAAA', fetchImpl: net, env: ENV })).rejects.toMatchObject({ status: 502 });
        const rate = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
        await expect(ocrImage({ base64: 'AAAA', fetchImpl: rate, env: ENV })).rejects.toMatchObject({ status: 429 });
    });

    it('returns empty text when nothing was parsed', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(ok({ ParsedResults: [] }));
        expect(await ocrImage({ base64: 'AAAA', fetchImpl, env: ENV })).toEqual({ text: '' });
    });
});
