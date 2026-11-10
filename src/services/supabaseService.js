// Supabase client and auth helpers. Data access (CRUD, mappers) lives in src/data/api.js.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase credentials are missing. Cloud sync and auth are disabled.');
}

// Create Supabase client with proper auth persistence
let supabase = null;
try {
    if (supabaseUrl && supabaseAnonKey) {
        supabase = createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storage: window.localStorage
            }
        });
    }
} catch (error) {
    console.error('Failed to initialize Supabase client:', error);
}

export { supabase };

// Auth helper functions
export const authHelpers = {
    async signUp(email, password) {
        if (!supabase) {
            // Provide detailed error message for debugging
            const missingUrl = !supabaseUrl;
            const missingKey = !supabaseAnonKey;

            let errorMsg = 'Supabase not configured. ';
            if (missingUrl && missingKey) {
                errorMsg += 'Both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing. ';
            } else if (missingUrl) {
                errorMsg += 'VITE_SUPABASE_URL is missing. ';
            } else if (missingKey) {
                errorMsg += 'VITE_SUPABASE_ANON_KEY is missing. ';
            } else {
                errorMsg += 'Supabase client failed to initialize. ';
            }
            errorMsg += 'Please check your environment variables in Vercel project settings.';

            throw new Error(errorMsg);
        }

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        });

        if (error) throw error;
        return data;
    },

    async signIn(email, password) {
        if (!supabase) {
            const errorMsg = !supabaseUrl || !supabaseAnonKey
                ? 'Supabase credentials not found. Please check your environment variables.'
                : 'Supabase client failed to initialize.';
            throw new Error(errorMsg);
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;
        return data;
    },

    async signOut() {
        if (!supabase) {
            // Don't throw error on signout if Supabase isn't configured
            console.warn('Supabase not configured, skipping signout');
            return;
        }

        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    },

    async getSession() {
        if (!supabase) return null;

        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
            console.error('Error getting session:', error);
            return null;
        }
        return session;
    },

    async getUser() {
        if (!supabase) return null;

        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) {
            console.error('Error getting user:', error);
            return null;
        }
        return user;
    },

    onAuthStateChange(callback) {
        if (!supabase) return { data: { subscription: null }, error: new Error('Supabase not configured') };

        return supabase.auth.onAuthStateChange(callback);
    },

    async signInWithOAuth(options) {
        if (!supabase) {
            throw new Error('Supabase not configured');
        }

        const { data, error } = await supabase.auth.signInWithOAuth(options);
        if (error) throw error;
        return { data, error: null };
    }
};
