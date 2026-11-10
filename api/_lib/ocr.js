// Single OCR.Space call. Used only when no vision model is configured.
// Env: OCR_SPACE_API_KEY
import { HttpError } from './http.js';

const ENDPOINT = 'https://api.ocr.space/parse/image';

// OCR.Space language codes for the UI languages / hints we receive.
const LANGUAGE_MAP = {
    en: 'eng', it: 'ita', de: 'ger', fr: 'fre', es: 'spa', nl: 'dut', pt: 'por', pl: 'pol',
    eng: 'eng', ita: 'ita', ger: 'ger', fre: 'fre', spa: 'spa', dut: 'dut', auto: 'auto',
};

export function toOcrLanguage(language) {
    const key = String(language || '').trim().toLowerCase().slice(0, 4);
    return LANGUAGE_MAP[key] || LANGUAGE_MAP[key.slice(0, 2)] || 'auto';
}

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'application/pdf': 'pdf' };

/**
 * ocrImage({ base64, mime, language }) -> { text }
 * Throws HttpError (502/503/504) on failure so handlers map it directly.
 */
export async function ocrImage({ base64, mime = 'image/jpeg', language = 'auto', timeoutMs = 25000, fetchImpl, env = process.env } = {}) {
    const apiKey = (env.OCR_SPACE_API_KEY || '').trim();
    if (!apiKey) throw new HttpError(503, 'OCR is not configured on the server', 'ocr_not_configured');
    if (!base64) throw new HttpError(400, 'Missing file', 'missing_file');

    const bytes = Buffer.from(String(base64).replace(/^data:[^,]+,/, '').replace(/\s+/g, ''), 'base64');
    const form = new FormData();
    form.append('apikey', apiKey);
    form.append('language', toOcrLanguage(language));
    form.append('OCREngine', '2');
    form.append('scale', 'true');
    form.append('detectOrientation', 'true');
    form.append('isTable', 'true');
    form.append('file', new Blob([bytes], { type: mime }), `receipt.${EXT[mime] || 'jpg'}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
        response = await (fetchImpl || globalThis.fetch)(ENDPOINT, { method: 'POST', body: form, signal: controller.signal });
    } catch (err) {
        throw new HttpError(err?.name === 'AbortError' ? 504 : 502, 'OCR request failed', 'ocr_failed');
    } finally {
        clearTimeout(timer);
    }
    if (!response.ok) {
        throw new HttpError(response.status === 429 ? 429 : 502, 'OCR provider error', 'ocr_failed');
    }
    let data;
    try {
        data = await response.json();
    } catch {
        throw new HttpError(502, 'OCR provider returned an invalid response', 'ocr_failed');
    }
    if (data?.IsErroredOnProcessing) {
        throw new HttpError(422, 'Could not read the image', 'ocr_unreadable');
    }
    const text = (data?.ParsedResults || [])
        .map((r) => r?.ParsedText || '')
        .join('\n')
        .replace(/\r/g, '')
        .trim();
    return { text };
}
