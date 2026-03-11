import { createClient } from '@supabase/supabase-js';
import { calculateNextRecurringDate } from '../utils/recurring';
import {
    buildCompletedReceiptFromSource,
    buildDoneTrackingData,
    buildOpenTrackingData,
    normalizeTrackingData,
} from '../utils/tracking';

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

        // Always use the authenticated user's ID from the session (RLS requirement)
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        // Use auth.uid() instead of receipt.userId to ensure RLS works
        const authenticatedUserId = user.id;
        console.log('[Supabase createReceipt] Creating receipt:', receipt.id);

        // Transform receipt to Supabase format and include the id if provided
        const supabaseReceipt = {
            ...(receipt.id && { id: receipt.id }), // Include id if provided to preserve local ID
            ...this.transformReceiptToSupabase({
                ...receipt,
                userId: authenticatedUserId // Override with authenticated user ID
            }),
            created_at: receipt.createdAt || new Date().toISOString(),
            updated_at: receipt.updatedAt || new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('receipts')
            .insert([supabaseReceipt])
            .select()
            .maybeSingle();

        if (error) {
            const errorMessage = error.message || error.details || error.hint || JSON.stringify(error);
            console.error('[Supabase createReceipt] Error:', error);
            console.error('[Supabase createReceipt] Error code:', error.code);
            console.error('[Supabase createReceipt] Error message:', errorMessage);
            console.error('[Supabase createReceipt] Auth user ID:', authenticatedUserId);
            console.error('[Supabase createReceipt] Receipt data:', {
                merchant: receipt.merchant,
                date: receipt.date,
                total: receipt.total,
                currency: receipt.currency,
                hasLineItems: !!receipt.lineItems
            });
            // Create a more descriptive error
            const descriptiveError = new Error(`Failed to create receipt: ${errorMessage} (Code: ${error.code || 'unknown'})`);
            descriptiveError.originalError = error;
            throw descriptiveError;
        }
        if (data) {
            return data;
        }

        // In some PostgREST/RLS paths insert succeeds but no single row can be coerced.
        return { id: receipt.id };
    },

    async getReceiptsByUserId(userId) {
        if (!supabase) throw new Error('Supabase not configured');

        // Always use the authenticated user's ID from the session for security
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        // Use auth.uid() to ensure RLS works and for security
        const authenticatedUserId = user.id;
        console.log('[Supabase getReceiptsByUserId] Using authenticated user ID:', authenticatedUserId);

        const { data, error } = await supabase
            .from('receipts')
            .select('*')
            .eq('user_id', authenticatedUserId) // Always use auth.uid() for RLS
            .order('date', { ascending: false });

        if (error) throw error;
        return data.map(this.transformReceiptFromSupabase);
    },

    async getReceiptById(id) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        const { data, error } = await supabase
            .from('receipts')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .maybeSingle();

        if (error) throw error;
        return data ? this.transformReceiptFromSupabase(data) : null;
    },

    async updateReceipt(id, updates) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        // Only transform and include fields that are actually provided in updates
        // This prevents overwriting existing data with empty values
        const supabaseUpdates = {};

        const fieldMap = {
            merchant: 'merchant',
            date: 'date',
            total: 'total',
            currency: 'currency',
            category: 'category',
            notes: 'notes',
            lineItems: 'line_items',
            isDemo: 'is_demo',
            isPinned: 'is_pinned',
            transactionType: 'transaction_type',
            groupId: 'group_id',
            groupName: 'group_name',
            groupTags: 'group_tags',
            splitData: 'split_data',
            recurringData: 'recurring_data',
            trackingData: 'tracking_data',
        };

        for (const [appField, dbField] of Object.entries(fieldMap)) {
            if (updates[appField] !== undefined) {
                // Special handling for groupId - validate UUID
                if (appField === 'groupId') {
                    supabaseUpdates[dbField] = updates[appField] && this.isValidUUID(updates[appField])
                        ? updates[appField]
                        : null;
                } else if (appField === 'trackingData') {
                    supabaseUpdates[dbField] = normalizeTrackingData(updates[appField]);
                } else {
                    supabaseUpdates[dbField] = updates[appField];
                }
            }
        }

        // Always update the timestamp
        supabaseUpdates.updated_at = new Date().toISOString();

        console.log('[Supabase updateReceipt] Updating receipt:', id, 'with fields:', Object.keys(supabaseUpdates));

        const { data, error } = await supabase
            .from('receipts')
            .update(supabaseUpdates)
            .eq('id', id)
            .eq('user_id', user.id)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (data) {
            return this.transformReceiptFromSupabase(data);
        }

        const fallback = await this.getReceiptById(id);
        if (!fallback) {
            throw new Error('Receipt not found in cloud for current user');
        }
        return fallback;
    },

    async deleteReceipt(id) {
        if (!supabase) throw new Error('Supabase not configured');

        const { error } = await supabase
            .from('receipts')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    async markReceiptAsDone(id) {
        if (!supabase) throw new Error('Supabase not configured');

        const receipt = await this.getReceiptById(id);
        if (!receipt) {
            throw new Error('Receipt not found');
        }

        const trackingData = normalizeTrackingData(receipt.trackingData);
        if (!trackingData?.isTracked) {
            throw new Error('Receipt is not enabled for mark as done');
        }

        if (trackingData.status === 'done') {
            return receipt;
        }

        const completedAt = new Date().toISOString();

        if (receipt.recurringData?.isActive) {
            const nextDate = calculateNextRecurringDate(receipt.date, receipt.recurringData.frequency);

            await this.createReceipt(buildCompletedReceiptFromSource(receipt, completedAt));
            await this.updateReceipt(id, {
                date: nextDate,
                recurringData: {
                    ...receipt.recurringData,
                    nextDueDate: nextDate,
                },
                trackingData: buildOpenTrackingData(trackingData),
            });

            return await this.getReceiptById(id);
        }

        await this.updateReceipt(id, {
            trackingData: buildDoneTrackingData(trackingData, completedAt),
        });

        return await this.getReceiptById(id);
    },

    // Upsert receipt - insert if not exists, update if exists
    async upsertReceipt(receipt) {
        if (!supabase) throw new Error('Supabase not configured');

        // Always use the authenticated user's ID from the session (RLS requirement)
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        const authenticatedUserId = user.id;
        console.log('[Supabase upsertReceipt] Upserting receipt:', receipt.id);

        // Transform receipt to Supabase format and include the id
        const supabaseReceipt = {
            id: receipt.id, // Must include id for upsert to work
            ...this.transformReceiptToSupabase({
                ...receipt,
                userId: authenticatedUserId // Override with authenticated user ID
            }),
            created_at: receipt.createdAt || new Date().toISOString(),
            updated_at: receipt.updatedAt || new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('receipts')
            .upsert([supabaseReceipt], {
                onConflict: 'id'
            })
            .select()
            .single();

        if (error) {
            console.error('[Supabase upsertReceipt] Error:', error);
            throw error;
        }
        return this.transformReceiptFromSupabase(data);
    },

    // Settings operations
    async saveSettings(userId, settings) {
        if (!supabase) throw new Error('Supabase not configured');

        // Always use the authenticated user's ID from the session (RLS requirement)
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        // Use auth.uid() instead of passed userId to ensure RLS works
        const authenticatedUserId = user.id;
        console.log('[Supabase saveSettings] Using authenticated user ID:', authenticatedUserId);

        // Support both ocrApiKey and legacy veryfiApiKey
        const apiKey = settings.ocrApiKey !== undefined ? settings.ocrApiKey : settings.veryfiApiKey;

        const { data, error } = await supabase
            .from('settings')
            .upsert({
                user_id: authenticatedUserId, // Always use auth.uid() for RLS
                veryfi_api_key: apiKey, // Still using old column name for backward compatibility
                default_currency: settings.defaultCurrency,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id'
            })
            .select()
            .single();

        if (error) {
            console.error('[Supabase saveSettings] Error:', error);
            console.error('[Supabase saveSettings] Auth user ID:', authenticatedUserId);
            throw error;
        }
        return data;
    },

    async getSettings(userId) {
        if (!supabase) throw new Error('Supabase not configured');

        // Always use the authenticated user's ID from the session for security
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        // Use auth.uid() to ensure RLS works and for security
        const authenticatedUserId = user.id;
        console.log('[Supabase getSettings] Using authenticated user ID:', authenticatedUserId);

        const { data, error } = await supabase
            .from('settings')
            .select('*')
            .eq('user_id', authenticatedUserId) // Always use auth.uid() for RLS
            .maybeSingle(); // Use maybeSingle() to return null instead of error when not found

        if (error) throw error;
        if (!data) return null;

        return {
            ocrApiKey: data.veryfi_api_key, // Return as ocrApiKey for new code
            veryfiApiKey: data.veryfi_api_key, // Keep legacy name for backward compatibility
            defaultCurrency: data.default_currency || 'EUR'
        };
    },

    // Transform Supabase receipt format to app format
    transformReceiptFromSupabase(supabaseReceipt) {
        const normalizedTrackingData = normalizeTrackingData(supabaseReceipt.tracking_data || null);
        return {
            id: supabaseReceipt.id,
            userId: supabaseReceipt.user_id,
            merchant: supabaseReceipt.merchant,
            date: supabaseReceipt.date,
            total: parseFloat(supabaseReceipt.total),
            currency: supabaseReceipt.currency || 'EUR',
            category: supabaseReceipt.category,
            notes: supabaseReceipt.notes,
            lineItems: supabaseReceipt.line_items || [],
            isDemo: supabaseReceipt.is_demo || false,
            isPinned: supabaseReceipt.is_pinned || false,
            transactionType: supabaseReceipt.transaction_type || 'expense',
            groupId: supabaseReceipt.group_id || null,
            groupName: supabaseReceipt.group_name || null,
            groupTags: supabaseReceipt.group_tags || [],
            splitData: supabaseReceipt.split_data || null,
            recurringData: supabaseReceipt.recurring_data || null,
            trackingData: normalizedTrackingData,
            createdAt: supabaseReceipt.created_at,
            updatedAt: supabaseReceipt.updated_at
        };
    },

    // Helper function to validate UUID format
    isValidUUID(str) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return str && typeof str === 'string' && uuidRegex.test(str);
    },

    // Transform app receipt format to Supabase format
    transformReceiptToSupabase(receipt) {
        // Validate groupId - if it's not a valid UUID (e.g., temporary group IDs like "group_..."),
        // set group_id to null but keep group_name and group_tags for reference
        const groupId = receipt.groupId && this.isValidUUID(receipt.groupId)
            ? receipt.groupId
            : null;

        const normalizedTrackingData = normalizeTrackingData(receipt.trackingData || null);

        return {
            user_id: receipt.userId,
            merchant: receipt.merchant,
            date: receipt.date,
            total: receipt.total,
            currency: receipt.currency || 'EUR',
            category: receipt.category,
            notes: receipt.notes,
            line_items: receipt.lineItems || [],
            is_demo: receipt.isDemo || false,
            is_pinned: receipt.isPinned || false,
            transaction_type: receipt.transactionType || 'expense',
            group_id: groupId,
            group_name: receipt.groupName || null,
            group_tags: receipt.groupTags || [],
            split_data: receipt.splitData || null,
            recurring_data: receipt.recurringData || null,
            tracking_data: normalizedTrackingData
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
    },

    // User Categories operations
    async createUserCategory(dataOrUserId, category) {
        if (!supabase) throw new Error('Supabase not configured');

        // Support both (data) and (userId, category) calling conventions
        const catData = category || dataOrUserId;

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        const authenticatedUserId = user.id;

        const record = {
            ...(catData.id && { id: catData.id }),
            user_id: authenticatedUserId,
            name: catData.name,
            color: catData.color || null
        };

        const { data, error } = await supabase
            .from('user_categories')
            .insert([record])
            .select()
            .single();

        if (error) throw error;
        return {
            id: data.id,
            userId: data.user_id,
            name: data.name,
            color: data.color,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        };
    },

    async upsertUserCategory(catData) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        const authenticatedUserId = user.id;

        const { data, error } = await supabase
            .from('user_categories')
            .upsert({
                id: catData.id,
                user_id: authenticatedUserId,
                name: catData.name,
                color: catData.color || null,
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' })
            .select()
            .single();

        if (error) throw error;
        return {
            id: data.id,
            userId: data.user_id,
            name: data.name,
            color: data.color,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        };
    },

    async getUserCategories(userId) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        const authenticatedUserId = user.id;

        const { data, error } = await supabase
            .from('user_categories')
            .select('*')
            .eq('user_id', authenticatedUserId)
            .order('name', { ascending: true });

        if (error) throw error;
        return data.map(cat => ({
            id: cat.id,
            userId: cat.user_id,
            name: cat.name,
            color: cat.color,
            createdAt: cat.created_at,
            updatedAt: cat.updated_at
        }));
    },

    async updateUserCategory(categoryId, updates) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('user_categories')
            .update({
                name: updates.name,
                color: updates.color,
                updated_at: new Date().toISOString()
            })
            .eq('id', categoryId)
            .select()
            .single();

        if (error) throw error;
        return {
            id: data.id,
            userId: data.user_id,
            name: data.name,
            color: data.color,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        };
    },

    async deleteUserCategory(categoryId) {
        if (!supabase) throw new Error('Supabase not configured');

        const { error } = await supabase
            .from('user_categories')
            .delete()
            .eq('id', categoryId);

        if (error) throw error;
    },

    // Group operations
    async createGroup(userId, groupData) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        const authenticatedUserId = user.id;
        console.log('[Supabase createGroup] Creating group:', groupData.id || 'new');

        const groupRecord = {
            ...(groupData.id && { id: groupData.id }), // Include id if provided to preserve local ID
            user_id: authenticatedUserId,
            name: groupData.name,
            color: groupData.color || '#3b82f6',
            is_pinned: groupData.isPinned || false,
            is_demo: groupData.isDemo || false,
            parent_group_id: groupData.parentGroupId || null,
            created_at: groupData.createdAt || new Date().toISOString(),
            updated_at: groupData.updatedAt || new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('groups')
            .insert([groupRecord])
            .select()
            .single();

        if (error) throw error;
        return this.transformGroupFromSupabase(data);
    },

    async getGroups(userId) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        const authenticatedUserId = user.id;

        const { data, error } = await supabase
            .from('groups')
            .select('*')
            .eq('user_id', authenticatedUserId)
            .order('is_pinned', { ascending: false })
            .order('name', { ascending: true });

        if (error) throw error;
        return data.map(group => this.transformGroupFromSupabase(group));
    },

    async updateGroup(groupId, updates) {
        if (!supabase) throw new Error('Supabase not configured');

        // Only include fields that are actually provided in updates
        const updateData = {
            updated_at: new Date().toISOString()
        };

        if (updates.name !== undefined) {
            updateData.name = updates.name;
        }
        if (updates.color !== undefined) {
            updateData.color = updates.color;
        }
        if (updates.isPinned !== undefined) {
            updateData.is_pinned = updates.isPinned;
        }
        if (updates.parentGroupId !== undefined) {
            updateData.parent_group_id = updates.parentGroupId || null;
        }

        console.log('[Supabase updateGroup] Updating group:', groupId, 'with fields:', Object.keys(updateData));

        const { data, error } = await supabase
            .from('groups')
            .update(updateData)
            .eq('id', groupId)
            .select()
            .single();

        if (error) throw error;
        return this.transformGroupFromSupabase(data);
    },

    // Upsert group - insert if not exists, update if exists
    async upsertGroup(group) {
        if (!supabase) throw new Error('Supabase not configured');

        // Always use the authenticated user's ID from the session (RLS requirement)
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        const authenticatedUserId = user.id;
        console.log('[Supabase upsertGroup] Using authenticated user ID:', authenticatedUserId);

        const supabaseGroup = {
            id: group.id,
            user_id: authenticatedUserId,
            name: group.name,
            color: group.color || '#3b82f6',
            is_pinned: group.isPinned || false,
            parent_group_id: group.parentGroupId || null,
            created_at: group.createdAt || new Date().toISOString(),
            updated_at: group.updatedAt || new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('groups')
            .upsert([supabaseGroup], {
                onConflict: 'id'
            })
            .select()
            .single();

        if (error) {
            console.error('[Supabase upsertGroup] Error:', error);
            throw error;
        }
        return this.transformGroupFromSupabase(data);
    },

    async deleteGroup(groupId) {
        if (!supabase) throw new Error('Supabase not configured');

        // First, get the group to check if it's nested
        const { data: group, error: groupError } = await supabase
            .from('groups')
            .select('parent_group_id')
            .eq('id', groupId)
            .single();

        if (groupError) {
            console.warn('[Delete Group] Failed to fetch group:', groupError);
        }

        // Check if this is a nested group (has parent_group_id)
        if (group && group.parent_group_id) {
            // This is a nested group - move receipts to parent group
            const { data: parentGroup, error: parentError } = await supabase
                .from('groups')
                .select('id, name')
                .eq('id', group.parent_group_id)
                .single();

            if (parentError) {
                console.warn('[Delete Group] Failed to fetch parent group:', parentError);
                // Fallback: ungroup receipts
                const { error: updateError } = await supabase
                    .from('receipts')
                    .update({
                        group_id: null,
                        group_name: null,
                        group_tags: []
                    })
                    .eq('group_id', groupId);

                if (updateError) {
                    console.warn('[Delete Group] Failed to ungroup receipts:', updateError);
                }
            } else {
                // Move receipts to parent group
                const { error: updateError } = await supabase
                    .from('receipts')
                    .update({
                        group_id: parentGroup.id,
                        group_name: parentGroup.name
                    })
                    .eq('group_id', groupId);

                if (updateError) {
                    console.warn('[Delete Group] Failed to move receipts to parent:', updateError);
                }
            }
        } else {
            // This is a parent group - ungroup all receipts
            const { error: updateError } = await supabase
                .from('receipts')
                .update({
                    group_id: null,
                    group_name: null,
                    group_tags: []
                })
                .eq('group_id', groupId);

            if (updateError) {
                console.warn('[Delete Group] Failed to ungroup receipts:', updateError);
            }
        }

        // Then delete the group
        const { error } = await supabase
            .from('groups')
            .delete()
            .eq('id', groupId);

        if (error) throw error;
    },

    // Transform group between app and Supabase formats
    transformGroupToSupabase(group) {
        return {
            user_id: group.userId,
            name: group.name,
            color: group.color || '#3b82f6',
            is_pinned: group.isPinned || false,
            parent_group_id: group.parentGroupId || null
        };
    },

    transformGroupFromSupabase(supabaseGroup) {
        return {
            id: supabaseGroup.id,
            userId: supabaseGroup.user_id,
            name: supabaseGroup.name,
            color: supabaseGroup.color || '#3b82f6',
            isPinned: supabaseGroup.is_pinned || false,
            isDemo: supabaseGroup.is_demo || false,
            parentGroupId: supabaseGroup.parent_group_id || null,
            createdAt: supabaseGroup.created_at,
            updatedAt: supabaseGroup.updated_at
        };
    },

    // User Layout operations
    async saveUserLayout(userId, layoutData) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        const authenticatedUserId = user.id;

        // Check if layout exists
        const { data: existing, error: selectError } = await supabase
            .from('user_layouts')
            .select('user_id')
            .eq('user_id', authenticatedUserId)
            .single();

        // If table doesn't exist, just return without error (layout saved locally)
        if (selectError && (selectError.code === '42P01' || selectError.message?.includes('user_layouts') || selectError.message?.includes('schema cache'))) {
            console.warn('[Supabase] user_layouts table not found. Layout saved locally only. Please run supabase_migration_v6.sql');
            return layoutData;
        }

        const layoutRecord = {
            user_id: authenticatedUserId,
            layout: layoutData,
            updated_at: new Date().toISOString()
        };

        if (existing) {
            const { error } = await supabase
                .from('user_layouts')
                .update(layoutRecord)
                .eq('user_id', authenticatedUserId);

            if (error) {
                // If table doesn't exist, just return without error
                if (error.code === '42P01' || error.message?.includes('user_layouts') || error.message?.includes('schema cache')) {
                    console.warn('[Supabase] user_layouts table not found. Layout saved locally only.');
                    return layoutData;
                }
                throw error;
            }
        } else {
            layoutRecord.created_at = new Date().toISOString();
            const { error } = await supabase
                .from('user_layouts')
                .insert([layoutRecord]);

            if (error) {
                // If table doesn't exist, just return without error
                if (error.code === '42P01' || error.message?.includes('user_layouts') || error.message?.includes('schema cache')) {
                    console.warn('[Supabase] user_layouts table not found. Layout saved locally only.');
                    return layoutData;
                }
                throw error;
            }
        }

        return layoutData;
    },

    async getUserLayout(userId) {
        if (!supabase) throw new Error('Supabase not configured');

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            throw new Error('Not authenticated. Please log in again.');
        }

        const authenticatedUserId = user.id;

        const { data, error } = await supabase
            .from('user_layouts')
            .select('layout')
            .eq('user_id', authenticatedUserId)
            .single();

        if (error) {
            // If table doesn't exist, return null instead of throwing
            if (error.code === '42P01' || error.message?.includes('user_layouts') || error.message?.includes('schema cache')) {
                console.warn('[Supabase] user_layouts table not found. Please run supabase_migration_v6.sql');
                return null;
            }
            // PGRST116 is "not found" - that's okay, return null
            if (error.code !== 'PGRST116') {
                throw error;
            }
        }

        return data?.layout || null;
    }
};

export default supabaseService;
