> This pipeline is to be replaced by AI structured extraction; see `docs/IMPROVEMENT_PLAN.md` (Phase 2).

# OCR.Space Integration

This app uses OCR.Space for receipt text extraction.

## How it works

1. **Without user API key**
   - Works only when server-side `OCR_SPACE_API_KEY` is configured
   - Useful for shared/team deployments

2. **With API key (optional)**
   - Get a free API key at https://ocr.space/ocrapi
   - 25,000 requests/month on free tier
   - Add your key in Settings

## Architecture

```
Browser → /api/ocr (Python serverless function) → OCR.Space API
```

The app uses serverless functions (`api/ocr.py` and optional `api/ocr-proxy.js`) to:
- Handle CORS issues
- Keep API keys server-side
- Process images securely

## Files

- `src/services/ocrApi.js` - Frontend OCR service
- `api/ocr.py` - Main Vercel OCR endpoint
- `api/ocr-proxy.js` - Optional JS proxy endpoint

## Local Development

The Vite dev server proxies `/api` requests. For local testing:

1. Start the dev server: `npm run dev`
2. OCR requests go to `/api/ocr`
3. The serverless endpoint forwards to OCR.Space API

## Production (Vercel)

Vercel automatically deploys files in `/api` as serverless functions.

1. Push to GitHub
2. Vercel deploys automatically
3. `/api/ocr` becomes the main serverless OCR endpoint

## OCR.Space Features Used

- **Engine 2**: Better for receipts and structured documents
- **Auto-rotate**: Detects and corrects image orientation
- **Table detection**: Helps parse receipt line items
- **Scale**: Enlarges small images for better recognition

## Response Parsing

OCR.Space returns plain text. The app parses it to extract:
- Merchant name (first few lines)
- Date (various formats)
- Total amount (looks for "TOTAL", "AMOUNT DUE", etc.)
- Line items (items with prices)

## Limitations

- Plain text output (no structured receipt data)
- May require manual corrections for complex receipts
- Rate limits on free tier

## Troubleshooting

### "Rate limit exceeded"
- Add your own OCR.Space API key in Settings
- Or wait and try again later

### Poor OCR accuracy
- Ensure good lighting when taking photos
- Keep the receipt flat and in focus
- Try cropping to just the receipt

### Proxy not working
- Check Vercel function logs
- Verify the function is deployed (`/api/ocr` returns a response)
