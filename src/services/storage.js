import Dexie from 'dexie';

// Lazy load supabaseService to avoid blocking initial load
const getSupabaseService = async () => {
    const module = await import('./supabaseService');
    return module.supabaseService;
};

const db = new Dexie('ReceiptManagerDB');

// Version 1: Initial schema
db.version(1).stores({
    users: '++id, email, password, passwordHash, supabaseId, createdAt',
    receipts: '++id, userId, supabaseId, merchant, date, total, currency, createdAt, updatedAt, syncedAt',
    settings: 'userId, veryfiApiKey, defaultCurrency, createdAt, updatedAt, syncedAt'
});

// Version 2: Updated schema with indexed supabaseId and removed password fields
db.version(2).stores({
    users: '++id, email, supabaseId, createdAt',
    receipts: '++id, userId, supabaseId, merchant, date, total, currency, createdAt, updatedAt, syncedAt',
    settings: 'userId, veryfiApiKey, defaultCurrency, createdAt, updatedAt, syncedAt'
}).upgrade(async (tx) => {
    // Migrate existing users: remove password fields and ensure supabaseId exists
    const users = await tx.table('users').toArray();
    for (const user of users) {
        const updates = {};
        if (user.password !== undefined) {
            // Note: We can't actually delete fields in IndexedDB, but we can set them to null
            // The new schema won't include these fields
        }
        // Ensure supabaseId is set if it exists
        if (user.supabaseId) {
            updates.supabaseId = user.supabaseId;
        }
        if (Object.keys(updates).length > 0) {
            await tx.table('users').update(user.id, updates);
        }
    }
});

export const storageService = {
    // User operations
    async createUser(userData) {
        // userData should contain: email, supabaseId (or supabaseUserId)
        const supabaseUserId = userData.supabaseId || userData.supabaseUserId;
        
        if (!supabaseUserId) {
            throw new Error('Supabase user ID is required');
        }

        // Check if user already exists
        const existing = await db.users.where('supabaseId').equals(supabaseUserId).first();
        if (existing) {
            return existing.id;
        }

        const id = await db.users.add({
            email: userData.email,
            supabaseId: supabaseUserId,
            createdAt: new Date().toISOString()
        });
        return id;
    },

    async getUserByEmail(email) {
        return await db.users.where('email').equals(email).first();
    },

    async getUserById(id) {
        return await db.users.get(id);
    },

    async getUserBySupabaseId(supabaseId) {
        return await db.users.where('supabaseId').equals(supabaseId).first();
    },

    // Receipt operations
    async createReceipt(receipt) {
        // receipt.userId should be the Supabase user ID (UUID)
        let supabaseId = null;
        
        // Try to sync to Supabase if configured
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured()) {
            try {
                // receipt.userId is already the Supabase user ID
                const supabaseReceipt = await supabaseService.createReceipt({
                    ...receipt,
                    userId: receipt.userId // This is already the Supabase user ID
                });
                supabaseId = supabaseReceipt.id;
            } catch (error) {
                console.error('Failed to create receipt in Supabase:', error);
                // Continue with local creation even if Supabase fails
            }
        }

        const id = await db.receipts.add({
            ...receipt,
            supabaseId,
            currency: receipt.currency || 'USD',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            syncedAt: supabaseId ? new Date().toISOString() : null
        });
        return id;
    },

    async getReceiptsByUserId(userId) {
        return await db.receipts.where('userId').equals(userId).reverse().sortBy('date');
    },

    async getReceiptById(id) {
        return await db.receipts.get(id);
    },

    async updateReceipt(id, updates) {
        const receipt = await db.receipts.get(id);
        
        // Try to sync to Supabase if configured
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured() && receipt) {
            try {
                if (receipt.supabaseId) {
                    // Receipt exists in Supabase, update it
                    await supabaseService.updateReceipt(receipt.supabaseId, {
                        ...receipt,
                        ...updates
                    });
                    // Update local receipt with synced timestamp
                    await db.receipts.update(id, {
                        ...updates,
                        updatedAt: new Date().toISOString(),
                        syncedAt: new Date().toISOString()
                    });
                } else {
                    // Receipt doesn't exist in Supabase yet, create it first
                    const supabaseReceipt = await supabaseService.createReceipt({
                        ...receipt,
                        ...updates,
                        userId: receipt.userId
                    });
                    // Update local receipt with Supabase ID and synced timestamp
                    await db.receipts.update(id, {
                        ...updates,
                        supabaseId: supabaseReceipt.id,
                        updatedAt: new Date().toISOString(),
                        syncedAt: new Date().toISOString()
                    });
                }
                return; // Successfully synced, return early
            } catch (error) {
                console.error('Failed to sync receipt update to Supabase:', error);
                // Continue with local update even if Supabase fails
            }
        }

        // Local update (if Supabase not configured or sync failed)
        await db.receipts.update(id, {
            ...updates,
            updatedAt: new Date().toISOString(),
            syncedAt: receipt?.supabaseId ? receipt.syncedAt : null // Keep existing syncedAt or null
        });
    },

    async deleteReceipt(id) {
        const receipt = await db.receipts.get(id);
        
        // Try to delete from Supabase if configured
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured() && receipt?.supabaseId) {
            try {
                await supabaseService.deleteReceipt(receipt.supabaseId);
            } catch (error) {
                console.error('Failed to delete receipt from Supabase:', error);
                // Continue with local deletion even if Supabase fails
                // The receipt will be deleted locally and can be cleaned up later via manual sync
            }
        }

        await db.receipts.delete(id);
    },

    // Settings operations
    async saveSettings(userId, settings) {
        // userId is now the Supabase user ID (UUID)
        const supabaseUserId = userId;

        // Save locally first (fast, always works)
        const existing = await db.settings.where('userId').equals(userId).first();
        if (existing) {
            await db.settings.update(existing.id, {
                ...settings,
                updatedAt: new Date().toISOString(),
                syncedAt: null // Will be updated if Supabase sync succeeds
            });
        } else {
            await db.settings.add({
                userId,
                ...settings,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedAt: null // Will be updated if Supabase sync succeeds
            });
        }

        // Try to sync to Supabase in background (don't block on this)
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured() && supabaseUserId) {
            // Use a timeout to prevent hanging
            const syncPromise = supabaseService.saveSettings(supabaseUserId, settings)
                .then(() => {
                    // Update syncedAt if sync succeeds
                    const localSettings = existing || await db.settings.where('userId').equals(userId).first();
                    if (localSettings) {
                        return db.settings.update(localSettings.id, {
                            syncedAt: new Date().toISOString()
                        });
                    }
                })
                .catch((error) => {
                    console.error('Failed to save settings in Supabase:', error);
                    // Don't throw - local save already succeeded
                });
            
            // Don't await - let it run in background
            // But add a timeout to prevent hanging
            Promise.race([
                syncPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Sync timeout')), 10000)
                )
            ]).catch(() => {
                // Timeout or error - that's okay, local save already succeeded
            });
        }
    },

    async getSettings(userId) {
        return await db.settings.where('userId').equals(userId).first();
    },

    async getVeryfiApiKey(userId) {
        const settings = await this.getSettings(userId);
        return settings?.veryfiApiKey || null;
    },

    async setVeryfiApiKey(userId, apiKey) {
        await this.saveSettings(userId, { veryfiApiKey: apiKey });
    },

    async getDefaultCurrency(userId) {
        const settings = await this.getSettings(userId);
        return settings?.defaultCurrency || 'USD';
    },

    async setDefaultCurrency(userId, currency) {
        await this.saveSettings(userId, { defaultCurrency: currency });
    },

    // Demo data
    async seedDemoData(userId) {
        const demoReceipts = generateDemoReceipts(userId);
        // Remove id field to let Dexie auto-generate
        const receiptsWithoutId = demoReceipts.map(({ id, ...receipt }) => receipt);
        await db.receipts.bulkAdd(receiptsWithoutId);
        return receiptsWithoutId.length;
    },

    async clearDemoData(userId) {
        const receipts = await this.getReceiptsByUserId(userId);
        const demoReceipts = receipts.filter(r => r.isDemo === true);
        if (demoReceipts.length > 0) {
            // Delete from Supabase if configured
            const supabaseService = await getSupabaseService();
            if (supabaseService.isConfigured()) {
                for (const receipt of demoReceipts) {
                    if (receipt.supabaseId) {
                        try {
                            await supabaseService.deleteReceipt(receipt.supabaseId);
                        } catch (error) {
                            console.error(`Failed to delete demo receipt ${receipt.id} from Supabase:`, error);
                        }
                    }
                }
            }
            await db.receipts.bulkDelete(demoReceipts.map(r => r.id));
        }
    },

    // Sync operations
    async syncAllToCloud(userId) {
        // userId is now the Supabase user ID (UUID)
        const supabaseService = await getSupabaseService();
        if (!supabaseService.isConfigured()) {
            console.warn('[Sync] Supabase not configured, cannot sync');
            return { synced: 0, errors: [] };
        }

        const errors = [];
        let synced = 0;

        // Sync receipts
        console.log('[Sync] Starting sync for userId:', userId);
        
        // Get all receipts for this user
        // First try by Supabase user ID (current format)
        let receipts = await this.getReceiptsByUserId(userId);
        console.log('[Sync] Found receipts by Supabase userId:', receipts.length);
        
        // If no receipts found, try to find by local user ID (for migration)
        if (receipts.length === 0) {
            const localUser = await this.getUserBySupabaseId(userId);
            if (localUser) {
                receipts = await this.getReceiptsByUserId(localUser.id);
                console.log('[Sync] Found receipts by local userId:', receipts.length);
                // Update receipts to use Supabase user ID
                if (receipts.length > 0) {
                    console.log('[Sync] Migrating receipts to use Supabase userId');
                    for (const receipt of receipts) {
                        await db.receipts.update(receipt.id, { userId: userId });
                    }
                }
            }
        }
        
        console.log('[Sync] Total receipts found:', receipts.length);
        console.log('[Sync] Receipt details:', receipts.map(r => ({
            id: r.id,
            userId: r.userId,
            supabaseId: r.supabaseId,
            syncedAt: r.syncedAt,
            merchant: r.merchant
        })));
        
        const unsyncedReceipts = receipts.filter(r => !r.syncedAt || !r.supabaseId);
        console.log('[Sync] Unsynced receipts:', unsyncedReceipts.length);
        
        if (unsyncedReceipts.length === 0 && receipts.length > 0) {
            console.log('[Sync] All receipts are already synced');
        }
        
        for (const receipt of unsyncedReceipts) {
            try {
                console.log('[Sync] Syncing receipt:', receipt.id, 'has supabaseId:', !!receipt.supabaseId);
                if (receipt.supabaseId) {
                    await supabaseService.updateReceipt(receipt.supabaseId, receipt);
                    await db.receipts.update(receipt.id, {
                        syncedAt: new Date().toISOString()
                    });
                } else {
                    const supabaseReceipt = await supabaseService.createReceipt({
                        ...receipt,
                        userId: userId // Use Supabase user ID directly
                    });
                    console.log('[Sync] Created receipt in Supabase:', supabaseReceipt.id);
                    await db.receipts.update(receipt.id, {
                        supabaseId: supabaseReceipt.id,
                        syncedAt: new Date().toISOString()
                    });
                }
                synced++;
                console.log('[Sync] Successfully synced receipt:', receipt.id);
            } catch (error) {
                console.error(`[Sync] Failed to sync receipt ${receipt.id}:`, error);
                errors.push({ receiptId: receipt.id, error: error.message });
            }
        }

        // Sync settings
        try {
            const settings = await this.getSettings(userId);
            if (settings) {
                await supabaseService.saveSettings(userId, settings);
                const existing = await db.settings.where('userId').equals(userId).first();
                if (existing) {
                    await db.settings.update(existing.id, {
                        syncedAt: new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            console.error('Failed to sync settings:', error);
            errors.push({ type: 'settings', error: error.message });
        }

        return { synced, errors };
    },

    async syncAllFromCloud(userId) {
        // userId is now the Supabase user ID (UUID)
        const supabaseService = await getSupabaseService();
        if (!supabaseService.isConfigured()) {
            console.warn('[Sync From Cloud] Supabase not configured');
            return { synced: 0, errors: [] };
        }

        const errors = [];
        let synced = 0;

        try {
            console.log('[Sync From Cloud] Starting sync for userId:', userId);
            // Get receipts from Supabase (already transformed to app format)
            const cloudReceipts = await supabaseService.getReceiptsByUserId(userId);
            console.log('[Sync From Cloud] Found receipts in cloud:', cloudReceipts.length);
            
            for (const cloudReceipt of cloudReceipts) {
                try {
                    console.log('[Sync From Cloud] Processing receipt:', cloudReceipt.id);
                    // Check if receipt exists locally
                    const localReceipt = await db.receipts
                        .where('supabaseId')
                        .equals(cloudReceipt.id)
                        .first();

                    if (localReceipt) {
                        // Update local receipt if cloud is newer
                        const cloudUpdated = new Date(cloudReceipt.updatedAt);
                        const localUpdated = new Date(localReceipt.updatedAt);
                        
                        console.log('[Sync From Cloud] Receipt exists locally, comparing dates:', {
                            cloud: cloudUpdated.toISOString(),
                            local: localUpdated.toISOString()
                        });
                        
                        if (cloudUpdated > localUpdated) {
                            // Only update fields that exist in IndexedDB schema
                            await db.receipts.update(localReceipt.id, {
                                merchant: cloudReceipt.merchant,
                                date: cloudReceipt.date,
                                total: cloudReceipt.total,
                                currency: cloudReceipt.currency || 'USD',
                                category: cloudReceipt.category,
                                notes: cloudReceipt.notes,
                                lineItems: cloudReceipt.lineItems || [],
                                isDemo: cloudReceipt.isDemo || false,
                                updatedAt: cloudReceipt.updatedAt,
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                            console.log('[Sync From Cloud] Updated local receipt:', localReceipt.id);
                        } else {
                            console.log('[Sync From Cloud] Local receipt is newer, skipping');
                        }
                    } else {
                        // Create new local receipt - only include fields in IndexedDB schema
                        // DO NOT include 'id' - IndexedDB will auto-generate it
                        console.log('[Sync From Cloud] Creating new local receipt');
                        const receiptToAdd = {
                            userId: userId, // Use Supabase user ID
                            supabaseId: cloudReceipt.id, // Store Supabase UUID for linking
                            merchant: cloudReceipt.merchant,
                            date: cloudReceipt.date,
                            total: cloudReceipt.total,
                            currency: cloudReceipt.currency || 'USD',
                            category: cloudReceipt.category,
                            notes: cloudReceipt.notes || '',
                            lineItems: cloudReceipt.lineItems || [],
                            isDemo: cloudReceipt.isDemo || false,
                            createdAt: cloudReceipt.createdAt || new Date().toISOString(),
                            updatedAt: cloudReceipt.updatedAt || new Date().toISOString(),
                            syncedAt: new Date().toISOString()
                        };
                        console.log('[Sync From Cloud] Receipt data to add:', receiptToAdd);
                        const localId = await db.receipts.add(receiptToAdd);
                        synced++;
                        console.log('[Sync From Cloud] Created local receipt with ID:', localId, 'for Supabase ID:', cloudReceipt.id);
                    }
                } catch (error) {
                    console.error(`[Sync From Cloud] Failed to sync receipt ${cloudReceipt.id}:`, error);
                    console.error('[Sync From Cloud] Error details:', {
                        message: error.message,
                        stack: error.stack,
                        receipt: cloudReceipt
                    });
                    errors.push({ receiptId: cloudReceipt.id, error: error.message });
                }
            }

            // Sync settings
            const cloudSettings = await supabaseService.getSettings(userId);
            if (cloudSettings) {
                await this.saveSettings(userId, cloudSettings);
                synced++;
            }
        } catch (error) {
            console.error('Failed to sync from cloud:', error);
            errors.push({ type: 'sync', error: error.message });
        }

        return { synced, errors };
    }
};

function generateDemoReceipts(userId) {
    const now = new Date();
    const receipts = [];

    // Grocery receipts
    receipts.push({
        id: `demo-${Date.now()}-1`,
        userId,
        merchant: 'Walmart',
        date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        total: 87.45,
        category: 'Groceries',
        lineItems: [
            { name: 'Milk', quantity: 2, price: 4.99, category: 'Groceries' },
            { name: 'Bread', quantity: 1, price: 3.49, category: 'Groceries' },
            { name: 'Eggs', quantity: 1, price: 5.99, category: 'Groceries' },
            { name: 'Chicken Breast', quantity: 2, price: 12.99, category: 'Groceries' },
            { name: 'Bananas', quantity: 1, price: 3.99, category: 'Groceries' },
            { name: 'Apples', quantity: 1, price: 5.99, category: 'Groceries' },
            { name: 'Pasta', quantity: 3, price: 2.99, category: 'Groceries' },
            { name: 'Tomato Sauce', quantity: 2, price: 1.99, category: 'Groceries' },
            { name: 'Cheese', quantity: 1, price: 4.99, category: 'Groceries' },
            { name: 'Yogurt', quantity: 4, price: 1.49, category: 'Groceries' },
            { name: 'Cereal', quantity: 2, price: 4.99, category: 'Groceries' },
            { name: 'Orange Juice', quantity: 1, price: 3.99, category: 'Groceries' },
            { name: 'Coffee', quantity: 1, price: 8.99, category: 'Groceries' },
            { name: 'Paper Towels', quantity: 1, price: 12.99, category: 'Groceries' },
            { name: 'Dish Soap', quantity: 1, price: 2.99, category: 'Groceries' }
        ],
        notes: 'Weekly grocery shopping',
        isDemo: true
    });

    // Restaurant receipt
    receipts.push({
        id: `demo-${Date.now()}-2`,
        userId,
        merchant: 'Starbucks',
        date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        total: 12.45,
        category: 'Restaurant',
        lineItems: [
            { name: 'Grande Latte', quantity: 1, price: 5.95, category: 'Restaurant' },
            { name: 'Blueberry Muffin', quantity: 1, price: 3.50, category: 'Restaurant' },
            { name: 'Cappuccino', quantity: 1, price: 4.75, category: 'Restaurant' }
        ],
        notes: 'Morning coffee',
        isDemo: true
    });

    // Gas receipt
    receipts.push({
        id: `demo-${Date.now()}-3`,
        userId,
        merchant: 'Shell Gas Station',
        date: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        total: 45.20,
        category: 'Gas',
        lineItems: [
            { name: 'Regular Gas', quantity: 12.5, price: 3.616, category: 'Gas' }
        ],
        notes: 'Fuel fill-up',
        isDemo: true
    });

    // Restaurant receipt
    receipts.push({
        id: `demo-${Date.now()}-4`,
        userId,
        merchant: 'McDonald\'s',
        date: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        total: 18.75,
        category: 'Restaurant',
        lineItems: [
            { name: 'Big Mac Meal', quantity: 1, price: 8.99, category: 'Restaurant' },
            { name: 'Chicken McNuggets', quantity: 1, price: 4.99, category: 'Restaurant' },
            { name: 'Apple Pie', quantity: 1, price: 1.99, category: 'Restaurant' },
            { name: 'Soft Drink', quantity: 2, price: 1.89, category: 'Restaurant' }
        ],
        notes: 'Lunch',
        isDemo: true
    });

    // Shopping receipt
    receipts.push({
        id: `demo-${Date.now()}-5`,
        userId,
        merchant: 'Target',
        date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        total: 125.80,
        category: 'Shopping',
        lineItems: [
            { name: 'T-Shirt', quantity: 2, price: 14.99, category: 'Shopping' },
            { name: 'Jeans', quantity: 1, price: 39.99, category: 'Shopping' },
            { name: 'Socks', quantity: 6, price: 12.99, category: 'Shopping' },
            { name: 'Toothbrush', quantity: 2, price: 4.99, category: 'Shopping' },
            { name: 'Shampoo', quantity: 1, price: 8.99, category: 'Shopping' },
            { name: 'Body Wash', quantity: 1, price: 6.99, category: 'Shopping' },
            { name: 'Towel Set', quantity: 1, price: 24.99, category: 'Shopping' },
            { name: 'Pillow', quantity: 2, price: 12.99, category: 'Shopping' }
        ],
        notes: 'Household items',
        isDemo: true
    });

    // Utilities receipt
    receipts.push({
        id: `demo-${Date.now()}-6`,
        userId,
        merchant: 'Electric Company',
        date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        total: 89.50,
        category: 'Utilities',
        lineItems: [
            { name: 'Electricity Service', quantity: 1, price: 89.50, category: 'Utilities' }
        ],
        notes: 'Monthly electricity bill',
        isDemo: true
    });

    // Entertainment receipt
    receipts.push({
        id: `demo-${Date.now()}-7`,
        userId,
        merchant: 'Netflix',
        date: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        total: 15.99,
        category: 'Entertainment',
        lineItems: [
            { name: 'Monthly Subscription', quantity: 1, price: 15.99, category: 'Entertainment' }
        ],
        notes: 'Streaming service',
        isDemo: true
    });

    // Healthcare receipt
    receipts.push({
        id: `demo-${Date.now()}-8`,
        userId,
        merchant: 'CVS Pharmacy',
        date: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        total: 32.45,
        category: 'Healthcare',
        lineItems: [
            { name: 'Prescription Medication', quantity: 1, price: 25.99, category: 'Healthcare' },
            { name: 'Vitamins', quantity: 1, price: 6.46, category: 'Healthcare' }
        ],
        notes: 'Pharmacy visit',
        isDemo: true
    });

    // Restaurant receipt
    receipts.push({
        id: `demo-${Date.now()}-9`,
        userId,
        merchant: 'Pizza Hut',
        date: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
        total: 28.50,
        category: 'Restaurant',
        lineItems: [
            { name: 'Large Pizza', quantity: 1, price: 18.99, category: 'Restaurant' },
            { name: 'Garlic Bread', quantity: 1, price: 5.99, category: 'Restaurant' },
            { name: 'Soft Drink', quantity: 2, price: 1.76, category: 'Restaurant' }
        ],
        notes: 'Dinner',
        isDemo: true
    });

    // Transportation receipt
    receipts.push({
        id: `demo-${Date.now()}-10`,
        userId,
        merchant: 'Uber',
        date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        total: 24.30,
        category: 'Transportation',
        lineItems: [
            { name: 'Ride Share', quantity: 1, price: 24.30, category: 'Transportation' }
        ],
        notes: 'Airport ride',
        isDemo: true
    });

    // Add timestamps
    receipts.forEach(receipt => {
        receipt.createdAt = receipt.date;
        receipt.updatedAt = receipt.date;
    });

    return receipts;
}

