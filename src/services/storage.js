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
    createReceipt: electricStorage.createReceipt,
    updateReceipt: electricStorage.updateReceipt,
    deleteReceipt: electricStorage.deleteReceipt,

    // Groups
    getAllGroups: electricStorage.getGroups,
    getGroups: electricStorage.getGroups,
    createGroup: electricStorage.createGroup,
    updateGroup: electricStorage.updateGroup,
    deleteGroup: electricStorage.deleteGroup,

    // Categories
    getCategories: electricStorage.getCategories,
    createCategory: electricStorage.createCategory,
    deleteCategory: electricStorage.deleteCategory,

    // Settings
    getSettings: electricStorage.getSettings,
    saveSettings: electricStorage.saveSettings,

    // User Layout
    getUserLayout: electricStorage.getUserLayout,
    saveUserLayout: electricStorage.saveUserLayout,

    // Sync utilities
    clearAllData: electricStorage.clearAllData,
    getSyncStatus: electricStorage.getSyncStatus,
    forcePush: electricStorage.forcePush,
    pullFromSupabase: electricStorage.pullFromSupabase,

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
                merged: 0,
                errors: result.errors,
            };
        } catch (error) {
            console.error('[Storage] syncBidirectional failed:', error);
            return {
                uploaded: 0,
                downloaded: 0,
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
    }
};

export default storageService;
