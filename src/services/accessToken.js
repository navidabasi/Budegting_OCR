/** Supabase access token for the Vercel API endpoints (bearer auth). null when signed out / not configured. */
export async function getAccessToken() {
    const { supabase } = await import('./supabaseService');
    const { data } = (await supabase?.auth.getSession()) || {};
    return data?.session?.access_token || null;
}
