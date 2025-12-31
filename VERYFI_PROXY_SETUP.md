# Veryfi API Proxy Setup

## Problem
Veryfi's API blocks direct browser requests due to CORS (Cross-Origin Resource Sharing) restrictions. This prevents the app from making OCR requests directly from the browser.

## Solution
A serverless proxy function that runs on Vercel handles the Veryfi API requests server-side, avoiding CORS issues.

## Files Created

### 1. `api/veryfi-proxy.js`
Vercel serverless function that:
- Receives the image file and API key from the frontend
- Makes the request to Veryfi API server-side
- Returns the OCR results to the frontend

## Deployment

### For Production (Vercel):

1. **The `api/veryfi-proxy.js` file is automatically deployed** when you push to Vercel
2. Vercel will automatically detect the `api/` folder and create serverless functions
3. The function will be agvailable at: `https://your-domain.vercel.app/api/veryfi-proxy`

### For Local Development:

The proxy won't work locally unless you:
1. Install Vercel CLI: `npm i -g vercel`
2. Run: `vercel dev` (instead of `npm run dev`)
3. Or use a local Node.js server (see alternative below)

## Alternative: Local Development Server

If you want to test locally without Vercel CLI, you can create a simple Express server:

1. Create `server.js`:
```javascript
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { handler } from './api/veryfi-proxy.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('dist'));

app.post('/api/veryfi-proxy', async (req, res) => {
    await handler(req, res);
});

app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
```

2. Install dependencies:
```bash
npm install express cors form-data
```

3. Run: `node server.js`

## Testing

1. Make sure your Veryfi API key is saved in Settings
2. Try uploading a receipt image
3. Check browser console for `[Veryfi API]` logs
4. The request should now go through the proxy instead of directly to Veryfi

## Troubleshooting

### "Function not found" error
- Make sure `api/veryfi-proxy.js` exists in your project root
- Redeploy to Vercel if in production
- Check Vercel dashboard → Functions to see if it's deployed

### Still getting CORS errors
- Make sure you're using the proxy endpoint (`/api/veryfi-proxy`)
- Check that the proxy function is deployed
- Verify the request is going to the proxy, not directly to Veryfi

### "form-data is not defined" error
- The serverless function needs the `form-data` package
- Add it to `package.json` dependencies if needed
- Vercel should handle this automatically, but you may need to add it manually

