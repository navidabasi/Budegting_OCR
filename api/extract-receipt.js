// POST /api/extract-receipt
// Body: { file: base64, mime: 'image/*', hints?: { language, defaultCurrency, categories, knownMerchants[<=50], accounts[] } }
// Returns { receipt, extraction }. PDFs are rasterised client-side (pdfjs) before upload.
// Env: LLM_* / LLM_VISION_* (see _lib/llm.js), OCR_SPACE_API_KEY, SUPABASE_*, AI_DAILY_LIMIT_PER_USER.
import { z } from 'zod';
import { route, HttpError, MAX_BODY_BYTES } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';
import { consume, recordTokens } from './_lib/ratelimit.js';
import { chat, hasVisionModel, NoVisionModelError } from './_lib/llm.js';
import { ocrImage } from './_lib/ocr.js';
import { loadPrompt, fillPrompt } from './_lib/prompts.js';
import { normalizeReceipt } from './_lib/receiptSchema.js';
import { EXPENSE_CATEGORIES } from '../src/utils/categoryNames.js';

const inputSchema = z.object({
    file: z.string().min(16),
    mime: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
    hints: z
        .object({
            language: z.string().max(10).optional(),
            defaultCurrency: z.string().length(3).optional(),
            categories: z.array(z.string().max(40)).max(60).optional(),
            knownMerchants: z.array(z.string().max(80)).max(50).optional(),
            accounts: z.array(z.string().max(60)).max(20).optional(),
        })
        .optional()
        .default({}),
});

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function buildSystemPrompt(hints, today = new Date()) {
    const categories = hints.categories?.length ? hints.categories : EXPENSE_CATEGORIES;
    return fillPrompt(loadPrompt('extract-receipt'), {
        TODAY: today.toISOString().slice(0, 10),
        LANGUAGE: hints.language || 'it',
        DEFAULT_CURRENCY: (hints.defaultCurrency || 'EUR').toUpperCase(),
        CATEGORIES: categories.join(', '),
        KNOWN_MERCHANTS: hints.knownMerchants?.length ? hints.knownMerchants.join(', ') : '(none)',
    });
}

export const handle = async ({ req, body }) => {
    const { userId, client } = await requireUser(req);
    const input = inputSchema.parse(body);

    if (!input.mime.startsWith('image/')) {
        throw new HttpError(415, 'Only image files are accepted (render PDFs to PNG first)', 'unsupported_media');
    }
    const base64 = input.file.replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
    if (!BASE64_RE.test(base64)) throw new HttpError(400, 'File must be base64', 'invalid_base64');
    if (Math.floor((base64.length * 3) / 4) > MAX_BODY_BYTES) throw new HttpError(413, 'File too large', 'payload_too_large');

    await consume(client, userId, 'extract');

    const hints = input.hints;
    const categories = hints.categories?.length ? hints.categories : EXPENSE_CATEGORIES;
    const system = buildSystemPrompt(hints);
    const started = Date.now();

    let result;
    let provider;
    let rawText;
    if (hasVisionModel()) {
        try {
            result = await chat({
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: 'Extract this receipt and answer with the json object.' },
                ],
                images: [{ base64, mime: input.mime }],
                vision: true,
                json: true,
                maxTokens: 2500,
                temperature: 0,
                timeoutMs: 45000,
            });
            provider = 'vision';
        } catch (err) {
            if (!(err instanceof NoVisionModelError)) throw err;
        }
    }
    if (!result) {
        const { text } = await ocrImage({ base64, mime: input.mime, language: hints.language });
        if (!text) throw new HttpError(422, 'No text could be read from the image', 'ocr_empty');
        rawText = text;
        result = await chat({
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: `OCR text of the receipt (may contain errors):\n\n${text}\n\nAnswer with the json object.` },
            ],
            json: true,
            maxTokens: 2500,
            temperature: 0,
        });
        provider = 'ocr+text';
    }

    let receipt;
    try {
        receipt = normalizeReceipt(result.data, { categories, defaultCurrency: hints.defaultCurrency });
    } catch {
        throw new HttpError(502, 'The AI returned an unusable receipt', 'invalid_output');
    }
    await recordTokens(client, userId, 'extract', result.usage);

    return {
        receipt,
        extraction: {
            provider,
            model: result.model,
            confidence: receipt.confidence,
            ...(rawText ? { rawText } : {}),
            durationMs: Date.now() - started,
        },
    };
};

export default route({ methods: ['POST'], handle });
