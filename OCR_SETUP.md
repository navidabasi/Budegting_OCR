# OCR.Space Integration

This app uses OCR.Space for receipt text extraction.

## How it works

1. **Free tier (no API key required)**
   - Works out of the box
   - Limited to ~500 requests/month
   - Good for personal use

2. **With API key (optional)**
   - Get a free API key at https://ocr.space/ocrapi
   - 25,000 requests/month on free tier
   - Add your key in Settings

## Architecture

```
Browser → /api/ocr-proxy → OCR.Space API
```

The app uses a Vercel serverless function (`api/ocr-proxy.js`) to:
- Handle CORS issues
- Keep API keys server-side
- Process images securely

## Files

- `src/services/ocrApi.js` - Frontend OCR service
- `api/ocr-proxy.js` - Vercel serverless proxy function

## Local Development

The Vite dev server proxies `/api` requests. For local testing:

1. Start the dev server: `npm run dev`
2. OCR requests go to `/api/ocr-proxy`
3. The proxy forwards to OCR.Space API

## Production (Vercel)

Vercel automatically deploys files in `/api` as serverless functions.

1. Push to GitHub
2. Vercel deploys automatically
3. `/api/ocr-proxy` becomes a serverless function

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

- Plain text output (no structured receipt data like Veryfi)
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
- Verify the function is deployed (`/api/ocr-proxy` returns a response)

