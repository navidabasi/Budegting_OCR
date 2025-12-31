import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Debug logging (works in both dev and production)
console.log('[Supabase Config]', {
    url: supabaseUrl ? '✅ Set' : '❌ Missing',
    key: supabaseAnonKey ? '✅ Set' : '❌ Missing',
    urlPreview: supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : 'N/A',
    envMode: import.meta.env.MODE,
    allViteEnvKeys: Object.keys(import.meta.env).filter(k => k.startsWith('VITE_'))
});

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('❌ Supabase credentials not found. Cloud sync will be disabled.');
    console.error('Environment check:', {
        VITE_SUPABASE_URL: supabaseUrl ? 'exists' : 'undefined',
        VITE_SUPABASE_ANON_KEY: supabaseAnonKey ? 'exists' : 'undefined',
        allEnvKeys: Object.keys(import.meta.env).filter(k => k.startsWith('VITE_')),
        mode: import.meta.env.MODE,
        prod: import.meta.env.PROD,
        dev: import.meta.env.DEV
    });
}

// Create Supabase client
let supabase = null;
try {
    if (supabaseUrl && supabaseAnonKey) {
        supabase = createClient(supabaseUrl, supabaseAnonKey);
        console.log('✅ Supabase client created successfully');
    } else {
        console.error('❌ Supabase client not created - missing credentials');
    }
} catch (error) {
    console.error('❌ Failed to create Supabase client:', error);
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

            console.error('Supabase signUp error:', {
                hasUrl: !!supabaseUrl,
                hasKey: !!supabaseAnonKey,
                envKeys: Object.keys(import.meta.env).filter(k => k.startsWith('VITE_'))
            });

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
    }
};

export const supabaseService = {
    // Check if Supabase is configured
    isConfigured() {
        return supabase !== null;
    },

    // User operations
    async createUser(userData) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('users')
            .insert([{
                email: userData.email,
                password_hash: userData.passwordHash
            }])
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async getUserByEmail(email) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle(); // Use maybeSingle() instead of single() to return null instead of error

        if (error) throw error;
        return data;
    },

    async getUserById(id) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        return data;
    },

    // Receipt operations
    async createReceipt(receipt) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('receipts')
            .insert([{
                user_id: receipt.userId,
                merchant: receipt.merchant,
                date: receipt.date,
                total: receipt.total,
                currency: receipt.currency || 'USD',
                category: receipt.category,
                notes: receipt.notes,
                line_items: receipt.lineItems || [],
                is_demo: receipt.isDemo || false
            }])
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async getReceiptsByUserId(userId) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('receipts')
            .select('*')
            .eq('user_id', userId)
            .order('date', { ascending: false });

        if (error) throw error;
        return data.map(this.transformReceiptFromSupabase);
    },

    async getReceiptById(id) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('receipts')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        return this.transformReceiptFromSupabase(data);
    },

    async updateReceipt(id, updates) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('receipts')
            .update({
                merchant: updates.merchant,
                date: updates.date,
                total: updates.total,
                currency: updates.currency,
                category: updates.category,
                notes: updates.notes,
                line_items: updates.lineItems,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return this.transformReceiptFromSupabase(data);
    },

    async deleteReceipt(id) {
        if (!supabase) throw new Error('Supabase not configured');

        const { error } = await supabase
            .from('receipts')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    // Settings operations
    async saveSettings(userId, settings) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('settings')
            .upsert({
                user_id: userId,
                veryfi_api_key: settings.veryfiApiKey,
                default_currency: settings.defaultCurrency,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id'
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async getSettings(userId) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('settings')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle(); // Use maybeSingle() to return null instead of error when not found

        if (error) throw error;
        if (!data) return null;

        return {
            veryfiApiKey: data.veryfi_api_key,
            defaultCurrency: data.default_currency || 'USD'
        };
    },

    // Transform Supabase receipt format to app format
    transformReceiptFromSupabase(supabaseReceipt) {
        return {
            id: supabaseReceipt.id,
            userId: supabaseReceipt.user_id,
            merchant: supabaseReceipt.merchant,
            date: supabaseReceipt.date,
            total: parseFloat(supabaseReceipt.total),
            currency: supabaseReceipt.currency || 'USD',
            category: supabaseReceipt.category,
            notes: supabaseReceipt.notes,
            lineItems: supabaseReceipt.line_items || [],
            isDemo: supabaseReceipt.is_demo || false,
            createdAt: supabaseReceipt.created_at,
            updatedAt: supabaseReceipt.updated_at
        };
    },

    // Transform app receipt format to Supabase format
    transformReceiptToSupabase(receipt) {
        return {
            user_id: receipt.userId,
            merchant: receipt.merchant,
            date: receipt.date,
            total: receipt.total,
            currency: receipt.currency || 'USD',
            category: receipt.category,
            notes: receipt.notes,
            line_items: receipt.lineItems || [],
            is_demo: receipt.isDemo || false
        };
    },

    // Sync operations
    async syncReceiptsToCloud(userId, localReceipts) {
        if (!supabase) return { synced: 0, errors: [] };

        const errors = [];
        let synced = 0;

        for (const receipt of localReceipts) {
            try {
                // Check if receipt exists in cloud
                const existing = await supabase
                    .from('receipts')
                    .select('id')
                    .eq('id', receipt.id)
                    .single();

                if (existing.data) {
                    // Update existing
                    await this.updateReceipt(receipt.id, receipt);
                } else {
                    // Create new
                    await this.createReceipt(receipt);
                }
                synced++;
            } catch (error) {
                console.error(`Failed to sync receipt ${receipt.id}:`, error);
                errors.push({ receiptId: receipt.id, error: error.message });
            }
        }

        return { synced, errors };
    },

    async syncReceiptsFromCloud(userId) {
        if (!supabase) return [];

        try {
            const receipts = await this.getReceiptsByUserId(userId);
            return receipts;
        } catch (error) {
            console.error('Failed to sync receipts from cloud:', error);
            return [];
        }
    }
};

