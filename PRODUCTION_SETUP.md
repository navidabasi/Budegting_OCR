# Production Deployment Setup Guide

## Environment Variables for Production

For production builds, you need to set environment variables **at build time**. Vite embeds environment variables during the build process.

### Option 1: Build with Environment Variables (Recommended)

Set environment variables when building:

```bash
VITE_SUPABASE_URL=https://oorwminabbdyfftdbibn.supabase.co \
VITE_SUPABASE_ANON_KEY=your-anon-key-here \
npm run build
```

### Option 2: Use .env.production File

Create a `.env.production` file in your project root:

```env
VITE_SUPABASE_URL=https://oorwminabbdyfftdbibn.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Then build:
```bash
npm run build
```

### Option 3: Platform-Specific Environment Variables

#### Vercel
1. Go to your project settings
2. Navigate to **Environment Variables**
3. Add:
   - `VITE_SUPABASE_URL` = `https://oorwminabbdyfftdbibn.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `your-anon-key-here`
4. Redeploy

#### Netlify
1. Go to **Site settings** → **Environment variables**
2. Add:
   - `VITE_SUPABASE_URL` = `https://oorwminabbdyfftdbibn.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `your-anon-key-here`
3. Redeploy

#### GitHub Pages / Static Hosting
You'll need to set them at build time before deploying, or use a build script.

## Email Confirmation Settings

If users aren't receiving emails in production:

1. **Disable Email Confirmation** (for testing):
   - Go to Supabase Dashboard
   - **Authentication** → **Providers** → **Email**
   - Toggle off **"Confirm email"**

2. **Configure Email Templates** (for production):
   - Go to **Authentication** → **Email Templates**
   - Update the confirmation email template
   - Make sure the redirect URL points to your production domain

3. **Check Email Provider**:
   - Supabase uses its own email service by default
   - For production, consider setting up a custom SMTP provider
   - Go to **Settings** → **Auth** → **SMTP Settings**

## Troubleshooting

### "Supabase not configured" Error

**Check:**
1. Environment variables are set correctly
2. Variables start with `VITE_` prefix
3. Build was done with the environment variables set
4. Check browser console for the exact error

**Debug:**
Add this temporarily to see what's loaded:
```javascript
console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
console.log('Supabase Key:', import.meta.env.VITE_SUPABASE_ANON_KEY ? 'Set' : 'Missing');
```

### IndexedDB Migration Error

If you see "KeyPath supabaseId on object store users is not indexed":
1. Clear your browser's IndexedDB:
   - Chrome: DevTools → Application → IndexedDB → Delete
   - Firefox: DevTools → Storage → IndexedDB → Delete
2. Refresh the page
3. The app will automatically migrate to the new schema

### Email Not Received

1. Check spam folder
2. Verify email confirmation is disabled (for testing)
3. Check Supabase Dashboard → Authentication → Users → Check user's email status
4. Make sure your production URL is whitelisted in Supabase (if using redirects)

