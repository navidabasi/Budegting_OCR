# Receipt scanning

Scanning is done by `api/extract-receipt.js` (Vercel Node function). The client (`src/pages/ScanPage.jsx`,
`src/services/receiptScan.js`) renders PDFs to an image in the browser, uploads one JPEG (<= 3 MB) and gets back
`{ receipt, extraction }` (see `api/_lib/receiptSchema.js`).

```
Browser (scan flow) -> POST /api/extract-receipt (Bearer: Supabase access token)
                         -> vision model (LLM_VISION_*), or OCR.Space text (OCR_SPACE_API_KEY) + text model
```

## Environment variables (Vercel, server side only)

| Variable | Purpose |
|---|---|
| `LLM_VISION_BASE_URL`, `LLM_VISION_API_KEY`, `LLM_VISION_MODEL` | Vision model used to read the photo |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Text model (OCR fallback, categorize, insights) |
| `OCR_SPACE_API_KEY` | Fallback OCR when no vision model is configured |
| `AI_DAILY_LIMIT_PER_USER` | Per-user daily cap on AI calls |

## Local development

`/api` is not served by `npm run dev`; run `vercel dev` to try scanning locally. Without it the request returns 404
and the app offers manual entry with the photo attached.

## Offline

A photo taken offline is stored with a placeholder transaction (`extraction.pending = true`) and read automatically
when the app is back online (`src/services/pendingScans.js`).

## Sharing receipts into the app

The PWA manifest declares a Web Share Target (`POST /share`). The service worker (`src/sw.js`) stores the shared
file(s) in IndexedDB and redirects to `/scan?shared=1`.
