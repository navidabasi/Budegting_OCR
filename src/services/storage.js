/**
 * Storage Service - Compatibility Layer
 * Re-exports from Electric storage for backward compatibility
 *
 * This replaces the old Dexie-based storage with Electric + PGlite
 * for real-time sync with Supabase.
 */

import { electricStorage } from './electricStorage';

// Re-export electricStorage as storageService for backward compatibility
export const storageService = {
    // Initialize
    init: electricStorage.init,

    // Receipts
    getReceiptsByUserId: electricStorage.getReceipts,
    getReceipt: electricStorage.getReceipt,
    getReceiptById: electricStorage.getReceipt,
    createReceipt: electricStorage.createReceipt,
    updateReceipt: electricStorage.updateReceipt,
    deleteReceipt: electricStorage.deleteReceipt,

    // Groups
    getAllGroups: electricStorage.getGroups,
    getGroups: electricStorage.getGroups,
    getGroupById: electricStorage.getGroup,
    async createGroup(userId, groupData) {
        // Transform from (userId, groupData) to ({ userId, ...groupData })
        return electricStorage.createGroup({ userId, ...groupData });
    },
    updateGroup: electricStorage.updateGroup,
    deleteGroup: electricStorage.deleteGroup,

    // Categories
    getCategories: electricStorage.getCategories,
    getUserCategories: electricStorage.getCategories,
    createCategory: electricStorage.createCategory,
    createUserCategory: electricStorage.createCategory,
    deleteCategory: electricStorage.deleteCategory,
    deleteUserCategory: electricStorage.deleteCategory,
    updateUserCategory: electricStorage.updateCategory,

    // Settings
    getSettings: electricStorage.getSettings,
    saveSettings: electricStorage.saveSettings,

    // Settings helper methods
    async getOcrApiKey(userId) {
        const settings = await electricStorage.getSettings(userId);
        return settings?.ocrApiKey || null;
    },

    async setOcrApiKey(userId, apiKey) {
        const settings = await electricStorage.getSettings(userId);
        return await electricStorage.saveSettings(userId, {
            ...settings,
            ocrApiKey: apiKey,
        });
    },

    async getDefaultCurrency(userId) {
        const settings = await electricStorage.getSettings(userId);
        return settings?.defaultCurrency || 'EUR';
    },

    async setDefaultCurrency(userId, currency) {
        const settings = await electricStorage.getSettings(userId);
        return await electricStorage.saveSettings(userId, {
            ...settings,
            defaultCurrency: currency,
        });
    },

    // User Layout
    getUserLayout: electricStorage.getUserLayout,
    saveUserLayout: electricStorage.saveUserLayout,

    // Sync utilities
    clearAllData: electricStorage.clearAllData,
    getSyncStatus: electricStorage.getSyncStatus,
    forcePush: electricStorage.forcePush,
    pullFromSupabase: electricStorage.pullFromSupabase,
    clearAndResync: electricStorage.clearAndResync,

    // Sync methods - now implemented with real pull/push functionality
    async syncAllFromCloud(userId) {
        console.log('[Storage] syncAllFromCloud called - pulling from Supabase');
        try {
            const result = await electricStorage.pullFromSupabase(userId);
            return { synced: result.pulled, errors: result.errors };
        } catch (error) {
            console.error('[Storage] syncAllFromCloud failed:', error);
            return { synced: 0, errors: [{ error: error.message }] };
        }
    },

    async syncBidirectional(userId) {
        console.log('[Storage] syncBidirectional called');
        try {
            const result = await electricStorage.syncBidirectional(userId);
            return {
                uploaded: result.uploaded,
                downloaded: result.downloaded,
                updated: result.updated || 0,
                merged: 0,
                errors: result.errors,
            };
        } catch (error) {
            console.error('[Storage] syncBidirectional failed:', error);
            return {
                uploaded: 0,
                downloaded: 0,
                updated: 0,
                merged: 0,
                errors: [{ error: error.message }],
            };
        }
    },

    // User methods (simplified - auth handled by Supabase)
    async getUserByEmail(email) {
        // Not needed with Supabase auth
        return null;
    },

    async createUser(userData) {
        // Not needed with Supabase auth - user is created in Supabase
        return userData.supabaseId || userData.userId;
    },

    async getUserById(id) {
        // Not needed with Supabase auth
        return null;
    },

    // Demo data methods
    async seedDemoData(userId) {
        const demoReceipts = [
            { merchant: 'Grocery Store', total: 85.50, category: 'Groceries', date: new Date().toISOString() },
            { merchant: 'Gas Station', total: 45.00, category: 'Gas', date: new Date(Date.now() - 86400000).toISOString() },
            { merchant: 'Restaurant', total: 32.75, category: 'Restaurant', date: new Date(Date.now() - 172800000).toISOString() },
            { merchant: 'Amazon', total: 129.99, category: 'Shopping', date: new Date(Date.now() - 259200000).toISOString() },
            { merchant: 'Electric Company', total: 95.00, category: 'Utilities', date: new Date(Date.now() - 345600000).toISOString() },
        ];

        let count = 0;
        for (const receipt of demoReceipts) {
            // Use createDemoReceipt which handles local-only storage
            await electricStorage.createDemoReceipt({
                userId,
                ...receipt,
                currency: 'EUR',
                isDemo: true,
                lineItems: [],
            });
            count++;
        }
        return count;
    },

    async clearDemoData(userId) {
        // Use dedicated method that properly cleans up demo data
        return await electricStorage.clearDemoData(userId);
    },
};

export default storageService;
