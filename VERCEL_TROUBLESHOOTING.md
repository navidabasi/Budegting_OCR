# Vercel Environment Variables Troubleshooting

## Issue: "Supabase not configured" in Production

If you're still getting this error after setting environment variables in Vercel, try these steps:

## Step 1: Verify Variables Are Set

1. Go to Vercel Dashboard → Your Project → **Settings** → **Environment Variables**
2. Make sure you see:
   - ✅ `VITE_SUPABASE_URL` 
   - ✅ `VITE_SUPABASE_ANON_KEY`
3. Check that they're enabled for **Production** environment (not just Preview/Development)

## Step 2: Force a New Deployment

**IMPORTANT:** After adding/updating environment variables, you MUST redeploy for them to take effect!

1. **Option A: Redeploy from Dashboard (RECOMMENDED)**
   - Go to **Deployments** tab
   - Click the **⋯** menu (three dots) on the latest deployment
   - Click **Redeploy**
   - ⚠️ **CRITICAL:** Make sure "Use existing Build Cache" is **UNCHECKED**
   - Click **Redeploy**
   - Wait for the build to complete

2. **Option B: Trigger via Git**
   - Make a small change (add a comment to any file)
   - Commit and push
   - This will trigger a new build with the environment variables
   - Note: This also uses the cache, so Option A is better for testing

## Step 3: Check Build Logs

1. Go to **Deployments** → Click on the latest deployment
2. Check the **Build Logs**
3. Look for any errors related to environment variables
4. The build should complete successfully

## Step 4: Verify in Browser Console

1. Open your production site
2. Open browser DevTools (F12) → **Console** tab
3. Look for these messages:
   - `[Supabase Config]` - should show ✅ Set for both URL and Key
   - If you see ❌ Missing, the variables weren't included in the build
   - Check the `allViteEnvKeys` array - it should include `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

## Step 5: Common Issues

### Variables Not Applied to Production
- Make sure you selected **Production** when adding the variables
- Vercel has separate environments: Production, Preview, Development
- You need to add variables for each environment you use

### Build Cache Issue
- Vercel might be using a cached build
- Solution: Redeploy with "Use existing Build Cache" **unchecked**

### Variable Names Wrong
- Must be exactly: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Case-sensitive
- Must start with `VITE_` for Vite to include them

### Values Have Extra Spaces
- Make sure there are no leading/trailing spaces in the values
- Copy-paste the exact values from your `.env.local` file

## Step 6: Test Locally with Production Build

To test if the build works with env vars:

```bash
# Create .env.production file
echo "VITE_SUPABASE_URL=https://oorwminabbdyfftdbibn.supabase.co" > .env.production
echo "VITE_SUPABASE_ANON_KEY=your-key-here" >> .env.production

# Build
npm run build

# Preview the build
npm run preview
```

If this works locally, the issue is with Vercel's environment variable setup.

## Step 7: Alternative - Use Vercel CLI

If the dashboard isn't working:

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Link your project
vercel link

# Add environment variables
vercel env add VITE_SUPABASE_URL production
# (paste the URL when prompted)

vercel env add VITE_SUPABASE_ANON_KEY production
# (paste the key when prompted)

# Redeploy
vercel --prod
```

## Still Not Working?

1. **Check Vercel Build Logs** for any errors
2. **Check Browser Console** for the exact error message
3. **Verify the values** are correct (no typos, correct URL format)
4. **Try a fresh deployment** by pushing a new commit

The improved error messages in the code will now tell you exactly which variable is missing!

