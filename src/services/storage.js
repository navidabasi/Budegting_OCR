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

// Version 3: Rename veryfiApiKey to ocrApiKey (OCR.Space integration)
db.version(3).stores({
    users: '++id, email, supabaseId, createdAt',
    receipts: '++id, userId, supabaseId, merchant, date, total, currency, createdAt, updatedAt, syncedAt',
    settings: 'userId, ocrApiKey, defaultCurrency, createdAt, updatedAt, syncedAt'
}).upgrade(async (tx) => {
    // Migrate existing settings: rename veryfiApiKey to ocrApiKey
    const allSettings = await tx.table('settings').toArray();
    for (const setting of allSettings) {
        if (setting.veryfiApiKey !== undefined) {
            await tx.table('settings').update(setting.userId, {
                ocrApiKey: setting.veryfiApiKey,
                veryfiApiKey: undefined
            });
        }
    }
});

// Version 4: Add transactionType, grouping, splitting, and custom categories
db.version(4).stores({
    users: '++id, email, supabaseId, createdAt',
    receipts: '++id, userId, supabaseId, merchant, date, total, currency, transactionType, groupId, createdAt, updatedAt, syncedAt',
    settings: 'userId, ocrApiKey, defaultCurrency, createdAt, updatedAt, syncedAt',
    userCategories: '++id, userId, supabaseId, name, createdAt, updatedAt, syncedAt'
}).upgrade(async (tx) => {
    // Migrate existing receipts: set transactionType to 'expense' by default
    const receipts = await tx.table('receipts').toArray();
    for (const receipt of receipts) {
        const updates = {};
        if (receipt.transactionType === undefined) {
            updates.transactionType = 'expense';
        }
        if (Object.keys(updates).length > 0) {
            await tx.table('receipts').update(receipt.id, updates);
        }
    }
});

// Version 5: Add groups table for folder-like group management
db.version(5).stores({
    users: '++id, email, supabaseId, createdAt',
    receipts: '++id, userId, supabaseId, merchant, date, total, currency, transactionType, groupId, createdAt, updatedAt, syncedAt',
    settings: 'userId, ocrApiKey, defaultCurrency, createdAt, updatedAt, syncedAt',
    userCategories: '++id, userId, supabaseId, name, createdAt, updatedAt, syncedAt',
    groups: '++id, userId, supabaseId, name, color, isPinned, createdAt, updatedAt, syncedAt'
}).upgrade(async (tx) => {
    // Migrate existing groups from receipts to groups table
    const receipts = await tx.table('receipts').toArray();
    const groupMap = new Map();
    
    // Collect unique groups from receipts
    receipts.forEach(receipt => {
        if (receipt.groupId && receipt.groupName) {
            const key = `${receipt.userId}_${receipt.groupName}`;
            if (!groupMap.has(key)) {
                groupMap.set(key, {
                    userId: receipt.userId,
                    name: receipt.groupName,
                    color: '#3b82f6', // Default blue
                    isPinned: false,
                    createdAt: receipt.createdAt || new Date().toISOString(),
                    updatedAt: receipt.updatedAt || new Date().toISOString(),
                    syncedAt: null
                });
            }
        }
    });
    
    // Create groups in IndexedDB
    for (const group of groupMap.values()) {
        await tx.table('groups').add(group);
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

        // Save locally FIRST (fast, always works)
        const id = await db.receipts.add({
            ...receipt,
            supabaseId: null,
            currency: receipt.currency || 'EUR',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            syncedAt: null
        });

        // Try to sync to Supabase in background (don't block on this)
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured()) {
            // Run sync in background with timeout - don't await
            const syncPromise = Promise.race([
                supabaseService.createReceipt({
                    ...receipt,
                    userId: receipt.userId
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Supabase sync timed out')), 5000)
                )
            ]).then(async (supabaseReceipt) => {
                // Update local receipt with Supabase ID
                await db.receipts.update(id, {
                    supabaseId: supabaseReceipt.id,
                    syncedAt: new Date().toISOString()
                });
                console.log('[Storage] Receipt synced to Supabase:', supabaseReceipt.id);
            }).catch((error) => {
                console.warn('[Storage] Background sync failed (will retry later):', error.message);
                // Receipt is saved locally, can be synced later
            });

            // Don't await - let it run in background
            syncPromise.catch(() => { }); // Prevent unhandled rejection
        }

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
        if (!receipt) {
            throw new Error(`Receipt ${id} not found`);
        }

        // Update locally FIRST (fast, always works)
        await db.receipts.update(id, {
            ...updates,
            updatedAt: new Date().toISOString()
        });

        // Try to sync to Supabase in background (don't block on this)
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured()) {
            const syncPromise = (async () => {
                try {
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Supabase sync timed out')), 5000)
                    );

                    if (receipt.supabaseId) {
                        // Receipt exists in Supabase, update it
                        await Promise.race([
                            supabaseService.updateReceipt(receipt.supabaseId, {
                                ...receipt,
                                ...updates
                            }),
                            timeoutPromise
                        ]);
                        await db.receipts.update(id, { syncedAt: new Date().toISOString() });
                        console.log('[Storage] Receipt update synced to Supabase');
                    } else {
                        // Receipt doesn't exist in Supabase yet, create it first
                        const supabaseReceipt = await Promise.race([
                            supabaseService.createReceipt({
                                ...receipt,
                                ...updates,
                                userId: receipt.userId
                            }),
                            timeoutPromise
                        ]);
                        await db.receipts.update(id, {
                            supabaseId: supabaseReceipt.id,
                            syncedAt: new Date().toISOString()
                        });
                        console.log('[Storage] Receipt created in Supabase:', supabaseReceipt.id);
                    }
                } catch (error) {
                    console.warn('[Storage] Background sync failed (will retry later):', error.message);
                }
            })();

            // Don't await - let it run in background
            syncPromise.catch(() => { }); // Prevent unhandled rejection
        }

        return; // Return immediately after local update
    },

    async deleteReceipt(id) {
        const receipt = await db.receipts.get(id);

        // Delete locally FIRST (fast, always works)
        await db.receipts.delete(id);

        // Try to delete from Supabase in background (don't block on this)
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured() && receipt?.supabaseId) {
            const syncPromise = Promise.race([
                supabaseService.deleteReceipt(receipt.supabaseId),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Supabase delete timed out')), 5000)
                )
            ]).then(() => {
                console.log('[Storage] Receipt deleted from Supabase');
            }).catch((error) => {
                console.warn('[Storage] Background delete failed:', error.message);
                // Receipt is deleted locally, Supabase might have orphan that can be cleaned up
            });

            // Don't await - let it run in background
            syncPromise.catch(() => { }); // Prevent unhandled rejection
        }
    },

    // Settings operations
    async saveSettings(userId, settings) {
        // Validate userId
        if (!userId || typeof userId !== 'string') {
            throw new Error(`Invalid userId: ${userId}. Expected a non-empty string.`);
        }

        // Validate and sanitize settings
        const sanitizedSettings = {
            ocrApiKey: settings.ocrApiKey ? String(settings.ocrApiKey) : (settings.veryfiApiKey ? String(settings.veryfiApiKey) : null),
            defaultCurrency: settings.defaultCurrency ? String(settings.defaultCurrency) : 'EUR'
        };

        // userId is now the Supabase user ID (UUID)
        const supabaseUserId = userId;

        // Save locally first (fast, always works)
        // Note: settings table uses userId as primary key, not auto-increment id
        const existing = await db.settings.where('userId').equals(userId).first();
        if (existing) {
            // Update using userId as the key (it's the primary key)
            await db.settings.put({
                userId: String(userId),
                ...sanitizedSettings,
                createdAt: existing.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedAt: null // Will be updated if Supabase sync succeeds
            });
        } else {
            await db.settings.add({
                userId: String(userId),
                ...sanitizedSettings,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedAt: null // Will be updated if Supabase sync succeeds
            });
        }

        // Try to sync to Supabase in background (don't block on this)
        // Wrap in try-catch to ensure it never throws and blocks the local save
        try {
            const supabaseService = await getSupabaseService();
            if (supabaseService.isConfigured() && supabaseUserId) {
                // Use a timeout to prevent hanging
                const syncPromise = supabaseService.saveSettings(supabaseUserId, sanitizedSettings)
                    .then(async () => {
                        // Update syncedAt if sync succeeds
                        const localSettings = await db.settings.where('userId').equals(userId).first();
                        if (localSettings) {
                            // Use put() since userId is the primary key
                            return db.settings.put({
                                ...localSettings,
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
        } catch (error) {
            // If Supabase service fails to load or any other error, just log it
            // Local save already succeeded, so don't throw
            console.error('Error setting up Supabase sync (local save succeeded):', error);
        }
    },

    async getSettings(userId) {
        return await db.settings.where('userId').equals(userId).first();
    },

    async getOcrApiKey(userId) {
        const settings = await this.getSettings(userId);
        // Check both ocrApiKey and legacy veryfiApiKey
        return settings?.ocrApiKey || settings?.veryfiApiKey || null;
    },

    async setOcrApiKey(userId, apiKey) {
        await this.saveSettings(userId, { ocrApiKey: apiKey });
    },

    // Legacy aliases for backward compatibility
    async getVeryfiApiKey(userId) {
        return this.getOcrApiKey(userId);
    },

    async setVeryfiApiKey(userId, apiKey) {
        return this.setOcrApiKey(userId, apiKey);
    },

    async getDefaultCurrency(userId) {
        const settings = await this.getSettings(userId);
        return settings?.defaultCurrency || 'EUR';
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
    // Helper function to merge two receipts (conflict resolution)
    mergeReceipts(localReceipt, cloudReceipt) {
        // Merge line items - combine both, remove duplicates
        const localItems = localReceipt.lineItems || [];
        const cloudItems = cloudReceipt.lineItems || [];
        const mergedItems = [...localItems];

        // Add cloud items that don't exist in local (by name and price)
        cloudItems.forEach(cloudItem => {
            const exists = mergedItems.some(localItem =>
                localItem.name === cloudItem.name &&
                localItem.price === cloudItem.price
            );
            if (!exists) {
                mergedItems.push(cloudItem);
            }
        });

        // Use the most recent data, but merge fields intelligently
        const localUpdated = new Date(localReceipt.updatedAt);
        const cloudUpdated = new Date(cloudReceipt.updatedAt);
        const isLocalNewer = localUpdated >= cloudUpdated;

        return {
            merchant: localReceipt.merchant || cloudReceipt.merchant,
            date: isLocalNewer ? localReceipt.date : cloudReceipt.date,
            total: Math.max(localReceipt.total || 0, cloudReceipt.total || 0), // Use higher total
            currency: localReceipt.currency || cloudReceipt.currency || 'EUR',
            category: localReceipt.category || cloudReceipt.category,
            notes: (localReceipt.notes || '') + (cloudReceipt.notes ? `\n[Cloud]: ${cloudReceipt.notes}` : ''),
            lineItems: mergedItems,
            isDemo: localReceipt.isDemo || cloudReceipt.isDemo || false,
            transactionType: localReceipt.transactionType || cloudReceipt.transactionType || 'expense',
            groupId: localReceipt.groupId || cloudReceipt.groupId || null,
            groupName: localReceipt.groupName || cloudReceipt.groupName || null,
            groupTags: localReceipt.groupTags || cloudReceipt.groupTags || [],
            splitData: localReceipt.splitData || cloudReceipt.splitData || null,
            updatedAt: new Date().toISOString() // Mark as just merged
        };
    },

    async syncBidirectional(userId) {
        // userId is now the Supabase user ID (UUID)
        const supabaseService = await getSupabaseService();
        if (!supabaseService.isConfigured()) {
            console.warn('[Sync] Supabase not configured, cannot sync');
            return { synced: 0, errors: [], conflicts: [] };
        }

        // Verify user is authenticated before syncing (with timeout)
        try {
            const { supabase } = await import('./supabaseService');
            const authCheck = supabase.auth.getUser();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Authentication check timed out')), 5000)
            );

            const { data: { user }, error: authError } = await Promise.race([authCheck, timeoutPromise]);

            if (authError || !user) {
                throw new Error('Not authenticated. Please log in again.');
            }
            if (user.id !== userId) {
                console.warn('[Sync] userId mismatch, using authenticated user ID:', user.id);
                userId = user.id;
            }
        } catch (error) {
            const errorMessage = error?.message || error?.error || String(error);
            console.error('[Sync] Authentication check failed:', error);
            return { synced: 0, errors: [{ type: 'auth', error: errorMessage }], conflicts: [] };
        }

        const errors = [];
        const conflicts = [];
        let synced = 0;

        // Helper function to add timeout to promises
        const withTimeout = (promise, timeoutMs, errorMsg) => {
            return Promise.race([
                promise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(errorMsg || 'Operation timed out')), timeoutMs)
                )
            ]);
        };

        console.log('[Sync] Starting bidirectional sync for userId:', userId);

        try {
            // Step 1: Get all local and cloud receipts
            let localReceipts = await this.getReceiptsByUserId(userId);

            // Migration check
            if (localReceipts.length === 0) {
                try {
                    const localUser = await this.getUserBySupabaseId(userId);
                    if (localUser) {
                        localReceipts = await this.getReceiptsByUserId(localUser.id);
                        if (localReceipts.length > 0) {
                            for (const receipt of localReceipts) {
                                await db.receipts.update(receipt.id, { userId: userId });
                            }
                        }
                    }
                } catch (migrationError) {
                    console.warn('[Sync] Migration check failed:', migrationError);
                }
            }

            const cloudReceipts = await supabaseService.getReceiptsByUserId(userId);
            console.log('[Sync] Local receipts:', localReceipts.length, 'Cloud receipts:', cloudReceipts.length);
            // Debug: Check if groups and splits are in cloud receipts
            const receiptsWithGroups = cloudReceipts.filter(r => r.groupId || r.groupName);
            const receiptsWithSplits = cloudReceipts.filter(r => r.splitData);
            console.log('[Sync] Cloud receipts with groups:', receiptsWithGroups.length, 'with splits:', receiptsWithSplits.length);

            // Step 2: Create maps for quick lookup
            const localMap = new Map(); // key: supabaseId or localId
            const cloudMap = new Map(); // key: supabaseId

            localReceipts.forEach(r => {
                const key = r.supabaseId || `local_${r.id}`;
                localMap.set(key, r);
            });

            cloudReceipts.forEach(r => {
                cloudMap.set(r.id, r);
            });

            const processed = new Set();

            // Step 3a: Process receipts that exist in both places
            for (const [supabaseId, cloudReceipt] of cloudMap) {
                const localReceipt = localMap.get(supabaseId);

                if (localReceipt) {
                    processed.add(supabaseId);

                    const localUpdated = new Date(localReceipt.updatedAt || 0);
                    const cloudUpdated = new Date(cloudReceipt.updatedAt || 0);

                    // Check for conflicts (both changed significantly)
                    const timeDiff = Math.abs(localUpdated.getTime() - cloudUpdated.getTime());
                    const hasConflict = timeDiff > 1000 && // More than 1 second difference
                        localReceipt.updatedAt !== cloudReceipt.updatedAt &&
                        JSON.stringify(localReceipt) !== JSON.stringify(cloudReceipt);

                    if (hasConflict) {
                        // CONFLICT DETECTED - Merge the two
                        console.log(`[Sync] Conflict detected for receipt ${supabaseId}, merging...`);
                        const mergedReceipt = this.mergeReceipts(localReceipt, cloudReceipt);

                        conflicts.push({
                            supabaseId,
                            localReceipt,
                            cloudReceipt,
                            mergedReceipt
                        });

                        try {
                            // Update both local and cloud with merged version
                            await db.receipts.update(localReceipt.id, {
                                ...mergedReceipt,
                                syncedAt: new Date().toISOString()
                            });

                            await withTimeout(
                                supabaseService.updateReceipt(supabaseId, {
                                    ...localReceipt,
                                    ...mergedReceipt
                                }),
                                10000,
                                'Update merged receipt timed out'
                            );

                            synced++;
                            console.log(`[Sync] Merged and synced receipt ${supabaseId}`);
                        } catch (error) {
                            const errorMessage = error?.message || error?.error || String(error);
                            errors.push({ type: 'merge', receiptId: localReceipt.id, error: errorMessage });
                        }

                    } else if (localUpdated > cloudUpdated) {
                        // Local is newer - upload to cloud
                        try {
                            await withTimeout(
                                supabaseService.updateReceipt(supabaseId, localReceipt),
                                10000,
                                'Update receipt timed out'
                            );
                            await db.receipts.update(localReceipt.id, {
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        } catch (error) {
                            const errorMessage = error?.message || error?.error || String(error);
                            errors.push({ type: 'upload', receiptId: localReceipt.id, error: errorMessage });
                        }

                    } else if (cloudUpdated > localUpdated) {
                        // Cloud is newer - download to local
                        try {
                            await db.receipts.update(localReceipt.id, {
                                merchant: cloudReceipt.merchant,
                                date: cloudReceipt.date,
                                total: cloudReceipt.total,
                                currency: cloudReceipt.currency || 'EUR',
                                category: cloudReceipt.category,
                                notes: cloudReceipt.notes,
                                lineItems: cloudReceipt.lineItems || [],
                                transactionType: cloudReceipt.transactionType || 'expense',
                                groupId: cloudReceipt.groupId || null,
                                groupName: cloudReceipt.groupName || null,
                                groupTags: cloudReceipt.groupTags || [],
                                splitData: cloudReceipt.splitData || null,
                                updatedAt: cloudReceipt.updatedAt,
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        } catch (error) {
                            const errorMessage = error?.message || error?.error || String(error);
                            errors.push({ type: 'download', receiptId: localReceipt.id, error: errorMessage });
                        }
                    } else {
                        // Timestamps equal - already in sync
                        await db.receipts.update(localReceipt.id, {
                            syncedAt: new Date().toISOString()
                        });
                    }
                }
            }

            // Step 3b: Process local-only receipts (upload to cloud)
            for (const [key, localReceipt] of localMap) {
                // Skip if already processed in Step 3a
                if (!key.startsWith('local_') && processed.has(key)) continue;

                // Handle items that need to be uploaded
                if (key.startsWith('local_') || !localReceipt.supabaseId) {
                    // New local item - create in cloud
                    try {
                        const cloudReceipt = await withTimeout(
                            supabaseService.createReceipt({
                                ...localReceipt,
                                userId: userId
                            }),
                            10000,
                            'Create receipt timed out'
                        );
                        await db.receipts.update(localReceipt.id, {
                            supabaseId: cloudReceipt.id,
                            syncedAt: new Date().toISOString()
                        });
                        synced++;
                    } catch (error) {
                        const errorMessage = error?.message || error?.error || String(error);
                        errors.push({ type: 'upload', receiptId: localReceipt.id, error: errorMessage });
                    }
                } else if (localReceipt.supabaseId && !processed.has(localReceipt.supabaseId)) {
                    // Local item has supabaseId but wasn't in cloudMap
                    // This could mean it was deleted from cloud or the ID is stale
                    // Try to update first, if that fails (404), create a new one
                    try {
                        await withTimeout(
                            supabaseService.updateReceipt(localReceipt.supabaseId, {
                                ...localReceipt,
                                userId: userId
                            }),
                            10000,
                            'Update receipt timed out'
                        );
                        // Update succeeded - item exists in cloud, just wasn't in our initial fetch
                        await db.receipts.update(localReceipt.id, {
                            syncedAt: new Date().toISOString()
                        });
                        synced++;
                    } catch (updateError) {
                        // Update failed - likely 404 (item doesn't exist in cloud)
                        // Create a new one and update the local supabaseId
                        try {
                            console.log(`[Sync] Receipt ${localReceipt.supabaseId} not found in cloud, creating new one`);
                            const cloudReceipt = await withTimeout(
                                supabaseService.createReceipt({
                                    ...localReceipt,
                                    userId: userId
                                }),
                                10000,
                                'Create receipt timed out'
                            );
                            await db.receipts.update(localReceipt.id, {
                                supabaseId: cloudReceipt.id,
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        } catch (createError) {
                            const errorMessage = createError?.message || createError?.error || String(createError);
                            errors.push({
                                type: 'upload',
                                receiptId: localReceipt.id,
                                error: `Update failed: ${updateError?.message}, Create failed: ${errorMessage}`
                            });
                        }
                    }
                }
            }

            // Step 3c: Process cloud-only receipts (download to local)
            for (const [supabaseId, cloudReceipt] of cloudMap) {
                if (!processed.has(supabaseId)) {
                    try {
                        await db.receipts.add({
                            userId: userId,
                            supabaseId: cloudReceipt.id,
                            merchant: cloudReceipt.merchant,
                            date: cloudReceipt.date,
                            total: cloudReceipt.total,
                            currency: cloudReceipt.currency || 'EUR',
                            category: cloudReceipt.category,
                            notes: cloudReceipt.notes || '',
                            lineItems: cloudReceipt.lineItems || [],
                            transactionType: cloudReceipt.transactionType || 'expense',
                            groupId: cloudReceipt.groupId || null,
                            groupName: cloudReceipt.groupName || null,
                            groupTags: cloudReceipt.groupTags || [],
                            splitData: cloudReceipt.splitData || null,
                            isDemo: cloudReceipt.isDemo || false,
                            createdAt: cloudReceipt.createdAt || new Date().toISOString(),
                            updatedAt: cloudReceipt.updatedAt || new Date().toISOString(),
                            syncedAt: new Date().toISOString()
                        });
                        synced++;
                    } catch (error) {
                        const errorMessage = error?.message || error?.error || String(error);
                        errors.push({ type: 'download', receiptId: cloudReceipt.id, error: errorMessage });
                    }
                }
            }

            // Step 4: Sync settings
            const localSettings = await this.getSettings(userId);
            const cloudSettings = await supabaseService.getSettings(userId);

            if (localSettings && cloudSettings) {
                const localUpdated = new Date(localSettings.updatedAt || 0);
                const cloudUpdated = new Date(cloudSettings.updatedAt || 0);

                if (localUpdated > cloudUpdated) {
                    await withTimeout(
                        supabaseService.saveSettings(userId, localSettings),
                        10000,
                        'Save settings timed out'
                    );
                } else if (cloudUpdated > localUpdated) {
                    await this.saveSettings(userId, cloudSettings);
                }
            } else if (localSettings) {
                await withTimeout(
                    supabaseService.saveSettings(userId, localSettings),
                    10000,
                    'Save settings timed out'
                );
            } else if (cloudSettings) {
                await this.saveSettings(userId, cloudSettings);
            }

            // Step 5: Sync user categories
            try {
                const localCategories = await this.getUserCategories(userId);
                const cloudCategories = await withTimeout(
                    supabaseService.getUserCategories(userId),
                    10000,
                    'Get user categories timed out'
                );

                // Create maps for easier lookup
                const localMap = new Map();
                localCategories.forEach(cat => {
                    const key = cat.supabaseId || `local_${cat.id}`;
                    localMap.set(key, cat);
                });

                const cloudMap = new Map();
                cloudCategories.forEach(cat => {
                    cloudMap.set(cat.id, cat);
                });

                const processed = new Set();

                // Process categories that exist in both local and cloud
                for (const [supabaseId, cloudCategory] of cloudMap) {
                    const localCategory = localMap.get(supabaseId);

                    if (localCategory) {
                        processed.add(supabaseId);

                        const localUpdated = new Date(localCategory.updatedAt || 0);
                        const cloudUpdated = new Date(cloudCategory.updatedAt || 0);

                        if (localUpdated > cloudUpdated) {
                            // Local is newer - upload to cloud
                            try {
                                await withTimeout(
                                    supabaseService.updateUserCategory(supabaseId, {
                                        name: localCategory.name,
                                        color: localCategory.color
                                    }),
                                    10000,
                                    'Update category timed out'
                                );
                                await db.userCategories.update(localCategory.id, {
                                    syncedAt: new Date().toISOString()
                                });
                                synced++;
                            } catch (error) {
                                const errorMessage = error?.message || error?.error || String(error);
                                errors.push({ type: 'category_upload', categoryId: localCategory.id, error: errorMessage });
                            }
                        } else if (cloudUpdated > localUpdated) {
                            // Cloud is newer - download to local
                            try {
                                await db.userCategories.update(localCategory.id, {
                                    name: cloudCategory.name,
                                    color: cloudCategory.color,
                                    updatedAt: cloudCategory.updatedAt,
                                    syncedAt: new Date().toISOString()
                                });
                                synced++;
                            } catch (error) {
                                const errorMessage = error?.message || error?.error || String(error);
                                errors.push({ type: 'category_download', categoryId: localCategory.id, error: errorMessage });
                            }
                        } else {
                            // Already in sync
                            await db.userCategories.update(localCategory.id, {
                                syncedAt: new Date().toISOString()
                            });
                        }
                    }
                }

                // Process local-only categories (upload to cloud)
                for (const [key, localCategory] of localMap) {
                    if (key.startsWith('local_') || !localCategory.supabaseId) {
                        // New local category - create in cloud
                        try {
                            const cloudCategory = await withTimeout(
                                supabaseService.createUserCategory(userId, {
                                    name: localCategory.name,
                                    color: localCategory.color
                                }),
                                10000,
                                'Create category timed out'
                            );
                            await db.userCategories.update(localCategory.id, {
                                supabaseId: cloudCategory.id,
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        } catch (error) {
                            const errorMessage = error?.message || error?.error || String(error);
                            errors.push({ type: 'category_upload', categoryId: localCategory.id, error: errorMessage });
                        }
                    } else if (localCategory.supabaseId && !processed.has(localCategory.supabaseId)) {
                        // Local category has supabaseId but wasn't in cloudMap
                        // Try to update first, if that fails (404), create a new one
                        try {
                            await withTimeout(
                                supabaseService.updateUserCategory(localCategory.supabaseId, {
                                    name: localCategory.name,
                                    color: localCategory.color
                                }),
                                10000,
                                'Update category timed out'
                            );
                            // Update succeeded - category exists in cloud
                            await db.userCategories.update(localCategory.id, {
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        } catch (updateError) {
                            // Update failed - likely 404 (category doesn't exist in cloud)
                            // Create a new one and update the local supabaseId
                            try {
                                console.log(`[Sync] Category ${localCategory.supabaseId} not found in cloud, creating new one`);
                                const cloudCategory = await withTimeout(
                                    supabaseService.createUserCategory(userId, {
                                        name: localCategory.name,
                                        color: localCategory.color
                                    }),
                                    10000,
                                    'Create category timed out'
                                );
                                await db.userCategories.update(localCategory.id, {
                                    supabaseId: cloudCategory.id,
                                    syncedAt: new Date().toISOString()
                                });
                                synced++;
                            } catch (createError) {
                                const errorMessage = createError?.message || createError?.error || String(createError);
                                errors.push({
                                    type: 'category_upload',
                                    categoryId: localCategory.id,
                                    error: `Update failed: ${updateError?.message}, Create failed: ${errorMessage}`
                                });
                            }
                        }
                    }
                }

                // Process cloud-only categories (download to local)
                for (const [supabaseId, cloudCategory] of cloudMap) {
                    if (!processed.has(supabaseId)) {
                        try {
                            await db.userCategories.add({
                                userId: userId,
                                supabaseId: cloudCategory.id,
                                name: cloudCategory.name,
                                color: cloudCategory.color,
                                createdAt: cloudCategory.createdAt || new Date().toISOString(),
                                updatedAt: cloudCategory.updatedAt || new Date().toISOString(),
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        } catch (error) {
                            const errorMessage = error?.message || error?.error || String(error);
                            errors.push({ type: 'category_download', categoryId: cloudCategory.id, error: errorMessage });
                        }
                    }
                }
            } catch (error) {
                const errorMessage = error?.message || error?.error || String(error);
                console.error('[Sync] Error syncing user categories:', error);
                errors.push({ type: 'category_sync', error: errorMessage });
            }

            // Sync groups bidirectionally
            try {
                const cloudGroups = await withTimeout(
                    supabaseService.getGroups(userId),
                    30000,
                    'Get groups timed out'
                );
                const localGroups = await this.getAllGroups(userId);

                // Create maps for comparison
                const cloudMap = new Map();
                cloudGroups.forEach(group => {
                    cloudMap.set(group.id, group);
                });

                const localMap = new Map();
                localGroups.forEach(group => {
                    const key = group.supabaseId ? group.supabaseId : `local_${group.id}`;
                    localMap.set(key, group);
                });

                const processed = new Set();

                // Process groups that exist in both
                for (const [supabaseId, cloudGroup] of cloudMap) {
                    const localGroup = localMap.get(supabaseId);
                    if (localGroup) {
                        processed.add(supabaseId);
                        const cloudUpdated = new Date(cloudGroup.updatedAt || 0);
                        const localUpdated = new Date(localGroup.updatedAt || 0);

                        if (localUpdated > cloudUpdated) {
                            // Local is newer - upload to cloud
                            try {
                                await withTimeout(
                                    supabaseService.updateGroup(supabaseId, {
                                        name: localGroup.name,
                                        color: localGroup.color,
                                        isPinned: localGroup.isPinned
                                    }),
                                    10000,
                                    'Update group timed out'
                                );
                                await db.groups.update(localGroup.id, {
                                    syncedAt: new Date().toISOString()
                                });
                                synced++;
                            } catch (error) {
                                const errorMessage = error?.message || error?.error || String(error);
                                errors.push({ type: 'group_upload', groupId: localGroup.id, error: errorMessage });
                            }
                        } else if (cloudUpdated > localUpdated) {
                            // Cloud is newer - download to local
                            try {
                                await db.groups.update(localGroup.id, {
                                    name: cloudGroup.name,
                                    color: cloudGroup.color,
                                    isPinned: cloudGroup.isPinned,
                                    updatedAt: cloudGroup.updatedAt,
                                    syncedAt: new Date().toISOString()
                                });
                                synced++;
                            } catch (error) {
                                const errorMessage = error?.message || error?.error || String(error);
                                errors.push({ type: 'group_download', groupId: localGroup.id, error: errorMessage });
                            }
                        } else {
                            // Already in sync
                            await db.groups.update(localGroup.id, {
                                syncedAt: new Date().toISOString()
                            });
                        }
                    }
                }

                // Process local-only groups (upload to cloud)
                for (const [key, localGroup] of localMap) {
                    if (key.startsWith('local_') || !localGroup.supabaseId) {
                        // New local group - create in cloud
                        try {
                            const cloudGroup = await withTimeout(
                                supabaseService.createGroup(userId, {
                                    name: localGroup.name,
                                    color: localGroup.color,
                                    isPinned: localGroup.isPinned
                                }),
                                10000,
                                'Create group timed out'
                            );
                            await db.groups.update(localGroup.id, {
                                supabaseId: cloudGroup.id,
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        } catch (error) {
                            const errorMessage = error?.message || error?.error || String(error);
                            errors.push({ type: 'group_upload', groupId: localGroup.id, error: errorMessage });
                        }
                    } else if (localGroup.supabaseId && !processed.has(localGroup.supabaseId)) {
                        // Local group has supabaseId but wasn't in cloudMap
                        // Try to update first, if that fails (404), create a new one
                        try {
                            await withTimeout(
                                supabaseService.updateGroup(localGroup.supabaseId, {
                                    name: localGroup.name,
                                    color: localGroup.color,
                                    isPinned: localGroup.isPinned
                                }),
                                10000,
                                'Update group timed out'
                            );
                            await db.groups.update(localGroup.id, {
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        } catch (updateError) {
                            // Update failed - likely 404 (group doesn't exist in cloud)
                            // Create a new one and update the local supabaseId
                            try {
                                console.log(`[Sync] Group ${localGroup.supabaseId} not found in cloud, creating new one`);
                                const cloudGroup = await withTimeout(
                                    supabaseService.createGroup(userId, {
                                        name: localGroup.name,
                                        color: localGroup.color,
                                        isPinned: localGroup.isPinned
                                    }),
                                    10000,
                                    'Create group timed out'
                                );
                                await db.groups.update(localGroup.id, {
                                    supabaseId: cloudGroup.id,
                                    syncedAt: new Date().toISOString()
                                });
                                synced++;
                            } catch (createError) {
                                const errorMessage = createError?.message || createError?.error || String(createError);
                                errors.push({
                                    type: 'group_upload',
                                    groupId: localGroup.id,
                                    error: `Update failed: ${updateError?.message}, Create failed: ${errorMessage}`
                                });
                            }
                        }
                    }
                }

                // Process cloud-only groups (download to local)
                for (const [supabaseId, cloudGroup] of cloudMap) {
                    if (!processed.has(supabaseId)) {
                        try {
                            await db.groups.add({
                                userId: userId,
                                supabaseId: cloudGroup.id,
                                name: cloudGroup.name,
                                color: cloudGroup.color || '#3b82f6',
                                isPinned: cloudGroup.isPinned || false,
                                createdAt: cloudGroup.createdAt || new Date().toISOString(),
                                updatedAt: cloudGroup.updatedAt || new Date().toISOString(),
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        } catch (error) {
                            const errorMessage = error?.message || error?.error || String(error);
                            errors.push({ type: 'group_download', groupId: cloudGroup.id, error: errorMessage });
                        }
                    }
                }
            } catch (error) {
                const errorMessage = error?.message || error?.error || String(error);
                console.error('[Sync] Error syncing groups:', error);
                errors.push({ type: 'group_sync', error: errorMessage });
            }

        } catch (error) {
            const errorMessage = error?.message || error?.error || String(error);
            console.error('[Sync] Error during bidirectional sync:', error);
            errors.push({ type: 'sync', error: errorMessage });
        }

        return { synced, errors, conflicts };
    },

    // Keep syncAllToCloud as alias for backward compatibility
    async syncAllToCloud(userId) {
        return this.syncBidirectional(userId);
    },

    async syncAllFromCloud(userId) {
        // userId is now the Supabase user ID (UUID)
        const supabaseService = await getSupabaseService();
        if (!supabaseService.isConfigured()) {
            console.warn('[Sync From Cloud] Supabase not configured');
            return { synced: 0, errors: [] };
        }

        // Verify user is authenticated before syncing (with timeout)
        try {
            const { supabase } = await import('./supabaseService');
            const authCheck = supabase.auth.getUser();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Authentication check timed out')), 5000)
            );

            const { data: { user }, error: authError } = await Promise.race([authCheck, timeoutPromise]);

            if (authError || !user) {
                throw new Error('Not authenticated. Please log in again.');
            }
            if (user.id !== userId) {
                console.warn('[Sync From Cloud] userId mismatch, using authenticated user ID:', user.id);
                // Use authenticated user ID instead
                userId = user.id;
            }
        } catch (error) {
            console.error('[Sync From Cloud] Authentication check failed:', error);
            return { synced: 0, errors: [{ type: 'auth', error: error.message || String(error) }] };
        }

        const errors = [];
        let synced = 0;

        try {
            console.log('[Sync From Cloud] Starting sync for userId:', userId);
            // Get receipts from Supabase (already transformed to app format)
            // Note: getReceiptsByUserId now uses auth.uid() internally for security
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
                                currency: cloudReceipt.currency || 'EUR',
                                category: cloudReceipt.category,
                                notes: cloudReceipt.notes,
                                lineItems: cloudReceipt.lineItems || [],
                                transactionType: cloudReceipt.transactionType || 'expense',
                                groupId: cloudReceipt.groupId || null,
                                groupName: cloudReceipt.groupName || null,
                                groupTags: cloudReceipt.groupTags || [],
                                splitData: cloudReceipt.splitData || null,
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
                            currency: cloudReceipt.currency || 'EUR',
                            category: cloudReceipt.category,
                            notes: cloudReceipt.notes || '',
                            lineItems: cloudReceipt.lineItems || [],
                            transactionType: cloudReceipt.transactionType || 'expense',
                            groupId: cloudReceipt.groupId || null,
                            groupName: cloudReceipt.groupName || null,
                            groupTags: cloudReceipt.groupTags || [],
                            splitData: cloudReceipt.splitData || null,
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

            // Sync user categories from cloud
            try {
                const cloudCategories = await supabaseService.getUserCategories(userId);
                const localCategories = await this.getUserCategories(userId);

                // Create a map of local categories by supabaseId
                const localMap = new Map();
                localCategories.forEach(cat => {
                    if (cat.supabaseId) {
                        localMap.set(cat.supabaseId, cat);
                    }
                });

                for (const cloudCategory of cloudCategories) {
                    const localCategory = localMap.get(cloudCategory.id);

                    if (localCategory) {
                        // Update existing local category if cloud is newer
                        const cloudUpdated = new Date(cloudCategory.updatedAt || 0);
                        const localUpdated = new Date(localCategory.updatedAt || 0);

                        if (cloudUpdated > localUpdated) {
                            await db.userCategories.update(localCategory.id, {
                                name: cloudCategory.name,
                                color: cloudCategory.color,
                                updatedAt: cloudCategory.updatedAt,
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        }
                    } else {
                        // Create new local category from cloud
                        await db.userCategories.add({
                            userId: userId,
                            supabaseId: cloudCategory.id,
                            name: cloudCategory.name,
                            color: cloudCategory.color,
                            createdAt: cloudCategory.createdAt || new Date().toISOString(),
                            updatedAt: cloudCategory.updatedAt || new Date().toISOString(),
                            syncedAt: new Date().toISOString()
                        });
                        synced++;
                    }
                }
            } catch (error) {
                console.error('[Sync From Cloud] Failed to sync user categories:', error);
                errors.push({ type: 'category_sync', error: error.message || String(error) });
            }

            // Sync groups from cloud
            try {
                const cloudGroups = await supabaseService.getGroups(userId);
                const localGroups = await this.getAllGroups(userId);

                // Create a map of local groups by supabaseId
                const localMap = new Map();
                localGroups.forEach(group => {
                    if (group.supabaseId) {
                        localMap.set(group.supabaseId, group);
                    }
                });

                for (const cloudGroup of cloudGroups) {
                    const localGroup = localMap.get(cloudGroup.id);

                    if (localGroup) {
                        // Update existing local group if cloud is newer
                        const cloudUpdated = new Date(cloudGroup.updatedAt || 0);
                        const localUpdated = new Date(localGroup.updatedAt || 0);

                        if (cloudUpdated > localUpdated) {
                            await db.groups.update(localGroup.id, {
                                name: cloudGroup.name,
                                color: cloudGroup.color,
                                isPinned: cloudGroup.isPinned,
                                updatedAt: cloudGroup.updatedAt,
                                syncedAt: new Date().toISOString()
                            });
                            synced++;
                        }
                    } else {
                        // Create new local group from cloud
                        await db.groups.add({
                            userId: userId,
                            supabaseId: cloudGroup.id,
                            name: cloudGroup.name,
                            color: cloudGroup.color || '#3b82f6',
                            isPinned: cloudGroup.isPinned || false,
                            createdAt: cloudGroup.createdAt || new Date().toISOString(),
                            updatedAt: cloudGroup.updatedAt || new Date().toISOString(),
                            syncedAt: new Date().toISOString()
                        });
                        synced++;
                    }
                }
            } catch (error) {
                console.error('[Sync From Cloud] Failed to sync groups:', error);
                errors.push({ type: 'group_sync', error: error.message || String(error) });
            }
        } catch (error) {
            console.error('Failed to sync from cloud:', error);
            errors.push({ type: 'sync', error: error.message });
        }

        return { synced, errors };
    },

    // User Categories operations
    async createUserCategory(userId, category) {
        if (!userId || typeof userId !== 'string') {
            throw new Error(`Invalid userId: ${userId}. Expected a non-empty string.`);
        }

        // Save locally first
        const id = await db.userCategories.add({
            userId: String(userId),
            name: String(category.name),
            color: category.color || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            syncedAt: null
        });

        // Try to sync to Supabase in background
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured()) {
            const syncPromise = Promise.race([
                supabaseService.createUserCategory(userId, category),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Sync timed out')), 5000)
                )
            ]).then(async (cloudCategory) => {
                await db.userCategories.update(id, {
                    supabaseId: cloudCategory.id,
                    syncedAt: new Date().toISOString()
                });
            }).catch((error) => {
                console.warn('[Storage] Background sync failed for category:', error.message);
            });
            syncPromise.catch(() => { });
        }

        return id;
    },

    // Group operations
    async createGroup(userId, groupData) {
        // groupData should contain: name, color, isPinned
        const now = new Date().toISOString();
        
        // Save locally FIRST
        const id = await db.groups.add({
            userId,
            name: groupData.name,
            color: groupData.color || '#3b82f6',
            isPinned: groupData.isPinned || false,
            supabaseId: null,
            createdAt: now,
            updatedAt: now,
            syncedAt: null
        });

        // Try to sync to Supabase in background
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured()) {
            const syncPromise = Promise.race([
                supabaseService.createGroup({
                    userId,
                    name: groupData.name,
                    color: groupData.color || '#3b82f6',
                    isPinned: groupData.isPinned || false
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Supabase sync timed out')), 5000)
                )
            ]).then(async (supabaseGroup) => {
                await db.groups.update(id, {
                    supabaseId: supabaseGroup.id,
                    syncedAt: new Date().toISOString()
                });
                console.log('[Storage] Group synced to Supabase:', supabaseGroup.id);
            }).catch((error) => {
                console.warn('[Storage] Background sync failed (will retry later):', error.message);
            });

            syncPromise.catch(() => { });
        }

        return id;
    },

    async getAllGroups(userId) {
        if (!userId) return [];
        const groups = await db.groups.where('userId').equals(userId).toArray();
        // Sort: pinned first, then by name
        return groups.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            return a.name.localeCompare(b.name);
        });
    },

    async getGroupById(id) {
        return await db.groups.get(id);
    },

    async getGroupBySupabaseId(supabaseId) {
        return await db.groups.where('supabaseId').equals(supabaseId).first();
    },

    async updateGroup(id, updates) {
        const group = await db.groups.get(id);
        if (!group) {
            throw new Error(`Group ${id} not found`);
        }

        // Update locally FIRST
        await db.groups.update(id, {
            ...updates,
            updatedAt: new Date().toISOString()
        });

        // Try to sync to Supabase in background
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured() && group.supabaseId) {
            const syncPromise = Promise.race([
                supabaseService.updateGroup(group.supabaseId, updates),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Sync timed out')), 5000)
                )
            ]).then(() => {
                return db.groups.update(id, {
                    syncedAt: new Date().toISOString()
                });
            }).catch((error) => {
                console.warn('[Storage] Background sync failed (will retry later):', error.message);
            });

            syncPromise.catch(() => { });
        }

        return id;
    },

    async deleteGroup(id) {
        const group = await db.groups.get(id);
        if (!group) {
            throw new Error(`Group ${id} not found`);
        }

        // Get groupId to match (could be local id or supabaseId)
        const groupIdToMatch = group.supabaseId || group.id;
        
        // Remove groupId from all receipts in this group
        // Match by both local id and supabaseId to catch all receipts
        const allReceipts = await db.receipts.toArray();
        const groupReceipts = allReceipts.filter(r => {
            if (!r.groupId) return false;
            const receiptGroupId = String(r.groupId);
            const targetGroupId = String(groupIdToMatch);
            return receiptGroupId === targetGroupId || 
                   receiptGroupId === String(group.id) ||
                   receiptGroupId === String(group.supabaseId);
        });
        
        for (const receipt of groupReceipts) {
            await db.receipts.update(receipt.id, {
                groupId: null,
                groupName: null,
                groupTags: []
            });
        }

        // Delete locally
        await db.groups.delete(id);

        // Try to sync deletion to Supabase in background
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured() && group.supabaseId) {
            const syncPromise = Promise.race([
                supabaseService.deleteGroup(group.supabaseId),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Sync timed out')), 5000)
                )
            ]).catch((error) => {
                console.warn('[Storage] Background sync failed (will retry later):', error.message);
            });

            syncPromise.catch(() => { });
        }

        return id;
    },

    async getUserCategories(userId) {
        if (!userId || typeof userId !== 'string') {
            return [];
        }
        return await db.userCategories.where('userId').equals(userId).toArray();
    },

    async updateUserCategory(id, updates) {
        // Update locally first
        await db.userCategories.update(id, {
            ...updates,
            updatedAt: new Date().toISOString()
        });

        // Try to sync to Supabase in background
        const category = await db.userCategories.get(id);
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured() && category?.supabaseId) {
            const syncPromise = Promise.race([
                supabaseService.updateUserCategory(category.supabaseId, updates),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Sync timed out')), 5000)
                )
            ]).then(async () => {
                await db.userCategories.update(id, {
                    syncedAt: new Date().toISOString()
                });
            }).catch((error) => {
                console.warn('[Storage] Background sync failed for category update:', error.message);
            });
            syncPromise.catch(() => { });
        }
    },

    async deleteUserCategory(id) {
        const category = await db.userCategories.get(id);

        // Delete locally first
        await db.userCategories.delete(id);

        // Try to delete from Supabase in background
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured() && category?.supabaseId) {
            const syncPromise = Promise.race([
                supabaseService.deleteUserCategory(category.supabaseId),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Sync timed out')), 5000)
                )
            ]).catch((error) => {
                console.warn('[Storage] Background delete failed for category:', error.message);
            });
            syncPromise.catch(() => { });
        }
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

