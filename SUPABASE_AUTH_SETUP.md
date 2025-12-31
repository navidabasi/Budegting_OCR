# Supabase Auth Migration - Setup Guide

## ✅ Code Changes Complete

The code has been migrated to use Supabase Auth. Here's what you need to do in Supabase:

## Step 1: Enable Supabase Auth

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project: **navidabasi's Project**
3. Go to **Authentication** → **Providers**
4. Make sure **Email** provider is enabled (it should be by default)
5. **Optional**: Configure email templates if you want custom emails

## Step 2: Run the SQL Setup Script

1. In Supabase Dashboard, go to **SQL Editor**
2. Open the file `supabase_setup.sql` from this project
3. **Copy and paste the entire SQL script** into the SQL Editor
4. Click **Run** (or press Cmd/Ctrl + Enter)

This will:
- Create the `receipts` and `settings` tables
- Set up Row Level Security (RLS) policies
- Create indexes for better performance
- Set up automatic `updated_at` timestamps

## Step 3: Verify Tables Were Created

1. Go to **Table Editor** in Supabase Dashboard
2. You should see:
   - ✅ `receipts` table
   - ✅ `settings` table
   - ✅ No `users` table (Supabase Auth handles this automatically)

## Step 4: Test the App

1. **Restart your dev server** (if it's running):
   ```bash
   npm run dev
   ```

2. **Create a new account** in the app
3. **Check Supabase Dashboard**:
   - Go to **Authentication** → **Users**
   - You should see your new user account!
   - Go to **Table Editor** → `receipts` and `settings`
   - Data should appear when you create receipts

## What Changed

### ✅ Removed
- Custom password hashing (bcryptjs) - Supabase handles this
- Manual user management - Supabase Auth handles this
- Custom user table - Using Supabase's `auth.users`

### ✅ Added
- Supabase Auth integration (`signUp`, `signIn`, `signOut`)
- Automatic session management
- RLS policies that work with Supabase Auth
- Auth state change listeners

### ✅ Improved
- More secure (Supabase handles password hashing)
- Simpler code (less to maintain)
- Better RLS policies (automatic user isolation)
- Cross-device sync works properly

## Important Notes

1. **Existing Users**: If you had users before, they won't work with the new system. They'll need to create new accounts.

2. **Email Confirmation**: By default, Supabase may require email confirmation. You can disable this in:
   - **Authentication** → **Providers** → **Email** → Toggle "Confirm email"

3. **RLS Policies**: The policies use `auth.uid()` which automatically gets the current user's ID from Supabase Auth. This means:
   - Users can only see their own data
   - No need to manually filter by user_id
   - More secure by default

## Troubleshooting

### "User already exists" error
- This means the email is already registered in Supabase Auth
- Try logging in instead, or use a different email

### "Failed to create user in Supabase"
- Check browser console for the exact error
- Make sure Supabase Auth is enabled
- Check that your `.env.local` file has the correct credentials

### Data not appearing in Supabase
- Check browser console for errors
- Verify RLS policies were created correctly
- Make sure you're logged in (check Authentication → Users)

## Next Steps

After setup is complete:
1. ✅ Test creating a new account
2. ✅ Test logging in
3. ✅ Create a receipt and verify it appears in Supabase
4. ✅ Test logout
5. ✅ Test sync buttons in Settings

The app should now work with Supabase Auth! 🎉

