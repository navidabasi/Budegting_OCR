import Dexie from 'dexie';

// Lazy load supabaseService to avoid blocking initial load
const getSupabaseService = async () => {
    const module = await import('./supabaseService');
    return module.supabaseService;
};

const db = new Dexie('ReceiptManagerDB');

db.version(1).stores({
    users: '++id, email, password, passwordHash, supabaseId, createdAt',
    receipts: '++id, userId, supabaseId, merchant, date, total, currency, createdAt, updatedAt, syncedAt',
    settings: 'userId, veryfiApiKey, defaultCurrency, createdAt, updatedAt, syncedAt'
});

export const storageService = {
    // User operations
    async createUser(userData) {
        let supabaseId = null;
        
        // Try to create user in Supabase if configured
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured()) {
            try {
                const supabaseUser = await supabaseService.createUser({
                    email: userData.email,
                    passwordHash: userData.passwordHash
                });
                supabaseId = supabaseUser.id;
            } catch (error) {
                console.error('Failed to create user in Supabase:', error);
                // Continue with local creation even if Supabase fails
            }
        }

        const id = await db.users.add({
            email: userData.email,
            password: userData.password, // Keep for backward compatibility
            passwordHash: userData.passwordHash,
            supabaseId,
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

    // Receipt operations
    async createReceipt(receipt) {
        let supabaseId = null;
        
        // Try to sync to Supabase if configured
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured()) {
            try {
                // Get user to find Supabase ID
                const user = await this.getUserById(receipt.userId);
                if (user?.supabaseId) {
                    const supabaseReceipt = await supabaseService.createReceipt({
                        ...receipt,
                        userId: user.supabaseId // Use Supabase user ID
                    });
                    supabaseId = supabaseReceipt.id;
                }
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
        if (supabaseService.isConfigured() && receipt?.supabaseId) {
            try {
                await supabaseService.updateReceipt(receipt.supabaseId, {
                    ...receipt,
                    ...updates
                });
            } catch (error) {
                console.error('Failed to update receipt in Supabase:', error);
                // Continue with local update even if Supabase fails
            }
        }

        await db.receipts.update(id, {
            ...updates,
            updatedAt: new Date().toISOString(),
            syncedAt: receipt?.supabaseId ? new Date().toISOString() : null
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
            }
        }

        await db.receipts.delete(id);
    },

    // Settings operations
    async saveSettings(userId, settings) {
        // Get user to find Supabase ID
        const user = await this.getUserById(userId);
        const supabaseUserId = user?.supabaseId;

        // Try to sync to Supabase if configured
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured() && supabaseUserId) {
            try {
                await supabaseService.saveSettings(supabaseUserId, settings);
            } catch (error) {
                console.error('Failed to save settings in Supabase:', error);
                // Continue with local save even if Supabase fails
            }
        }

        const existing = await db.settings.where('userId').equals(userId).first();
        if (existing) {
            await db.settings.update(existing.id, {
                ...settings,
                updatedAt: new Date().toISOString(),
                syncedAt: supabaseUserId ? new Date().toISOString() : null
            });
        } else {
            await db.settings.add({
                userId,
                ...settings,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedAt: supabaseUserId ? new Date().toISOString() : null
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
        const supabaseService = await getSupabaseService();
        if (!supabaseService.isConfigured()) {
            return { synced: 0, errors: [] };
        }

        const user = await this.getUserById(userId);
        if (!user?.supabaseId) {
            console.warn('User does not have Supabase ID, cannot sync');
            return { synced: 0, errors: [] };
        }

        const errors = [];
        let synced = 0;

        // Sync receipts
        const receipts = await this.getReceiptsByUserId(userId);
        const unsyncedReceipts = receipts.filter(r => !r.syncedAt || !r.supabaseId);
        
        for (const receipt of unsyncedReceipts) {
            try {
                if (receipt.supabaseId) {
                    await supabaseService.updateReceipt(receipt.supabaseId, receipt);
                } else {
                    const supabaseReceipt = await supabaseService.createReceipt(receipt);
                    await db.receipts.update(receipt.id, {
                        supabaseId: supabaseReceipt.id,
                        syncedAt: new Date().toISOString()
                    });
                }
                synced++;
            } catch (error) {
                console.error(`Failed to sync receipt ${receipt.id}:`, error);
                errors.push({ receiptId: receipt.id, error: error.message });
            }
        }

        // Sync settings
        try {
            const settings = await this.getSettings(userId);
            if (settings) {
                await supabaseService.saveSettings(user.supabaseId, settings);
                await db.settings.update(settings.id, {
                    syncedAt: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('Failed to sync settings:', error);
            errors.push({ type: 'settings', error: error.message });
        }

        return { synced, errors };
    },

    async syncAllFromCloud(userId) {
        const supabaseService = await getSupabaseService();
        if (!supabaseService.isConfigured()) {
            return { synced: 0, errors: [] };
        }

        const user = await this.getUserById(userId);
        if (!user?.supabaseId) {
            console.warn('User does not have Supabase ID, cannot sync');
            return { synced: 0, errors: [] };
        }

        const errors = [];
        let synced = 0;

        try {
            // Get receipts from Supabase
            const cloudReceipts = await supabaseService.getReceiptsByUserId(user.supabaseId);
            
            for (const cloudReceipt of cloudReceipts) {
                try {
                    // Check if receipt exists locally
                    const localReceipt = await db.receipts
                        .where('supabaseId')
                        .equals(cloudReceipt.id)
                        .first();

                    if (localReceipt) {
                        // Update local receipt if cloud is newer
                        const cloudUpdated = new Date(cloudReceipt.updatedAt);
                        const localUpdated = new Date(localReceipt.updatedAt);
                        
                        if (cloudUpdated > localUpdated) {
                            await db.receipts.update(localReceipt.id, {
                                ...cloudReceipt,
                                userId: userId, // Keep local userId
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        }
                    } else {
                        // Create new local receipt
                        await db.receipts.add({
                            ...cloudReceipt,
                            userId: userId, // Use local userId
                            supabaseId: cloudReceipt.id,
                            syncedAt: new Date().toISOString()
                        });
                        synced++;
                    }
                } catch (error) {
                    console.error(`Failed to sync receipt ${cloudReceipt.id}:`, error);
                    errors.push({ receiptId: cloudReceipt.id, error: error.message });
                }
            }

            // Sync settings
            const cloudSettings = await supabaseService.getSettings(user.supabaseId);
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

