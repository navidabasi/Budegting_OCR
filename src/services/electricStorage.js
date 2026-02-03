/**
 * PGlite Storage Service with Supabase Sync
 * Local-first storage using PGlite (Postgres in browser)
 * Syncs with Supabase via REST API
 * Falls back to Supabase-only if PGlite fails (CSP issues)
 */

// Configuration
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// Database instance
let db = null;
let dbInitFailed = false;
let dbInitializing = null; // Promise to track ongoing initialization
let PGliteClass = null;
let syncListeners = new Map();

// Timeout helper
const withTimeout = (promise, timeoutMs, errorMessage) => {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        )
    ]);
};

/**
 * Initialize PGlite database with schema
 */
async function initDatabase() {
    // Return existing db if available
    if (db) return db;
    
    // Don't retry if already failed
    if (dbInitFailed) return null;
    
    // If already initializing, wait for that to complete
    if (dbInitializing) {
        console.log('[Storage] Waiting for existing initialization...');
        return dbInitializing;
    }

    console.log('[Storage] Initializing PGlite database...');

    // Create a promise for the initialization
    dbInitializing = (async () => {
        try {
            // Dynamic import with timeout
            if (!PGliteClass) {
                console.log('[Storage] Loading PGlite module...');
                const module = await withTimeout(
                    import('@electric-sql/pglite'),
                    10000,
                    'PGlite module load timed out'
                );
                PGliteClass = module.PGlite;
            }

            console.log('[Storage] Creating PGlite instance...');
            const newDb = new PGliteClass('idb://receipts-electric-v2', {
                relaxedDurability: true,
            });

            // Wait for database to be ready with timeout
            console.log('[Storage] Waiting for database to be ready...');
            await withTimeout(
                newDb.waitReady,
                15000,
                'PGlite waitReady timed out'
            );

            // Set db before creating tables (so we can use it)
            db = newDb;
            console.log('[Storage] PGlite instance ready, creating schema...');

            // Create schema with timeout protection
            await withTimeout(createSchema(), 30000, 'Schema creation timed out');

            console.log('[Storage] Database initialized successfully');
            return db;
        } catch (err) {
            console.error('[Storage] PGlite initialization failed:', err);
            dbInitFailed = true;
            db = null;
            return null;
        } finally {
            dbInitializing = null;
        }
    })();

    return dbInitializing;
}

/**
 * Create database schema
 */
async function createSchema() {
    if (!db) return;

    try {
        await db.exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    } catch (e) {
        console.log('[Storage] UUID extension already exists or not needed');
    }

    // Receipts table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS receipts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL,
            merchant TEXT,
            date TIMESTAMPTZ NOT NULL,
            total DECIMAL(10, 2) NOT NULL,
            currency TEXT DEFAULT 'EUR',
            category TEXT,
            notes TEXT,
            line_items JSONB DEFAULT '[]'::jsonb,
            is_demo BOOLEAN DEFAULT FALSE,
            is_pinned BOOLEAN DEFAULT FALSE,
            transaction_type TEXT DEFAULT 'expense',
            group_id UUID,
            group_name TEXT,
            group_tags TEXT[],
            split_data JSONB,
            recurring_data JSONB,
            field_timestamps JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            _synced BOOLEAN DEFAULT FALSE,
            _sync_failed BOOLEAN DEFAULT FALSE
        );
    `);

    // Add _sync_failed column if it doesn't exist (for existing databases)
    try {
        await db.exec(`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS _sync_failed BOOLEAN DEFAULT FALSE;`);
    } catch (e) {
        // Column might already exist
    }

    // Groups table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS groups (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#6366f1',
            is_pinned BOOLEAN DEFAULT FALSE,
            is_demo BOOLEAN DEFAULT FALSE,
            parent_group_id UUID,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            _synced BOOLEAN DEFAULT FALSE,
            _sync_failed BOOLEAN DEFAULT FALSE
        );
    `);

    // Add _sync_failed column if it doesn't exist (for existing databases)
    try {
        await db.exec(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS _sync_failed BOOLEAN DEFAULT FALSE;`);
    } catch (e) {
        // Column might already exist
    }

    // User categories table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS user_categories (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#6366f1',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            _synced BOOLEAN DEFAULT FALSE,
            UNIQUE(user_id, name)
        );
    `);

    // Settings table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID UNIQUE NOT NULL,
            ocr_api_key TEXT,
            default_currency TEXT DEFAULT 'EUR',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            _synced BOOLEAN DEFAULT FALSE
        );
    `);

    // User layouts table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS user_layouts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID UNIQUE NOT NULL,
            layout JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            _synced BOOLEAN DEFAULT FALSE
        );
    `);

    // Create indexes
    try {
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date);`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_receipts_synced ON receipts(_synced);`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_groups_user_id ON groups(user_id);`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_categories_user_id ON user_categories(user_id);`);
    } catch (e) {
        console.log('[Storage] Some indexes may already exist');
    }
}


/**
 * Push local changes to Supabase
 */
async function pushToRemote(table, operation, data) {
    if (!SUPABASE_URL) return;

    // Skip settings - they're handled directly in saveSettings
    if (table === 'settings') {
        return;
    }

    const supabaseService = await import('./supabaseService.js');

    try {
        if (operation === 'insert') {
            await supabaseService.default[`create${capitalizeFirst(singularize(table))}`](data);
        } else if (operation === 'update') {
            await supabaseService.default[`update${capitalizeFirst(singularize(table))}`](data.id, data);
        } else if (operation === 'upsert') {
            // Upsert - insert if not exists, update if exists
            await supabaseService.default[`upsert${capitalizeFirst(singularize(table))}`](data);
        } else if (operation === 'delete') {
            await supabaseService.default[`delete${capitalizeFirst(singularize(table))}`](data.id);
        }

        // Mark as synced successfully
        if (db && operation !== 'delete') {
            await db.query(`UPDATE ${table} SET _synced = TRUE, _sync_failed = FALSE WHERE id = $1`, [data.id]);
        }
    } catch (error) {
        console.error(`[Storage] Failed to push ${operation} to ${table}:`, error);
        // Mark as sync failed so we don't accidentally delete it during pull
        if (db && operation !== 'delete') {
            try {
                await db.query(`UPDATE ${table} SET _sync_failed = TRUE WHERE id = $1`, [data.id]);
            } catch (e) {
                console.error(`[Storage] Failed to mark sync failure:`, e);
            }
        }
        throw error; // Re-throw to let caller handle
    }
}

// Helper functions
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function singularize(str) {
    if (str.endsWith('ies')) return str.slice(0, -3) + 'y';
    if (str.endsWith('s')) return str.slice(0, -1);
    return str;
}

function notifyListeners(table) {
    const listeners = syncListeners.get(table) || [];
    listeners.forEach(listener => listener());

    // Also dispatch DOM events for hooks
    window.dispatchEvent(new CustomEvent(`refresh${capitalizeFirst(table)}`));
}

// ============================================
// PUBLIC API - Storage Service
// ============================================

export const electricStorage = {
    /**
     * Check if PGlite is available
     */
    isPGliteAvailable() {
        return db !== null && !dbInitFailed;
    },

    /**
     * Initialize the local PGlite database
     */
    async init(userId = null) {
        try {
            await initDatabase();
            if (db) {
                console.log('[Storage] PGlite database initialized');
            } else {
                console.warn('[Storage] PGlite not available, using Supabase directly');
            }
        } catch (err) {
            console.error('[Storage] Init failed:', err);
            dbInitFailed = true;
        }
        return this;
    },

    /**
     * Subscribe to table changes
     */
    subscribe(table, callback) {
        const listeners = syncListeners.get(table) || [];
        listeners.push(callback);
        syncListeners.set(table, listeners);

        return () => {
            const idx = listeners.indexOf(callback);
            if (idx > -1) listeners.splice(idx, 1);
        };
    },

    // ============================================
    // RECEIPTS
    // ============================================

    async getReceipts(userId) {
        try {
            await initDatabase();
            if (!db) {
                // Fallback to Supabase
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                return await supabaseService.getReceiptsByUserId(userId);
            }
            const result = await db.query(
                `SELECT * FROM receipts WHERE user_id = $1 ORDER BY date DESC, created_at DESC`,
                [userId]
            );
            return result.rows.map(this._mapReceipt);
        } catch (err) {
            console.error('[Storage] getReceipts failed, trying Supabase:', err);
            const supabaseService = (await import('./supabaseService.js')).supabaseService;
            return await supabaseService.getReceiptsByUserId(userId);
        }
    },

    async getReceipt(id) {
        try {
            await initDatabase();
            if (!db) {
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                return await supabaseService.getReceiptById(id);
            }
            const result = await db.query(`SELECT * FROM receipts WHERE id = $1`, [id]);
            return result.rows[0] ? this._mapReceipt(result.rows[0]) : null;
        } catch (err) {
            console.error('[Storage] getReceipt failed, trying Supabase:', err);
            const supabaseService = (await import('./supabaseService.js')).supabaseService;
            return await supabaseService.getReceiptById(id);
        }
    },

    async createReceipt(receipt) {
        const now = new Date().toISOString();
        const id = crypto.randomUUID();

        try {
            await initDatabase();
            if (!db) {
                // Fallback to Supabase directly
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                const result = await supabaseService.createReceipt({ id, ...receipt });
                window.dispatchEvent(new Event('refreshReceipts'));
                window.dispatchEvent(new Event('refreshDashboard'));
                return result.id || id;
            }

            await db.query(`
                INSERT INTO receipts (
                    id, user_id, merchant, date, total, currency, category, notes,
                    line_items, is_demo, is_pinned, transaction_type, group_id,
                    group_name, group_tags, split_data, recurring_data, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            `, [
                id,
                receipt.userId,
                receipt.merchant,
                receipt.date,
                receipt.total,
                receipt.currency || 'EUR',
                receipt.category,
                receipt.notes,
                JSON.stringify(receipt.lineItems || []),
                receipt.isDemo || false,
                receipt.isPinned || false,
                receipt.transactionType || 'expense',
                receipt.groupId,
                receipt.groupName,
                receipt.groupTags || [],
                receipt.splitData ? JSON.stringify(receipt.splitData) : null,
                receipt.recurringData ? JSON.stringify(receipt.recurringData) : null,
                now,
                now
            ]);

            // Push to remote in background
            pushToRemote('receipts', 'insert', { id, ...receipt });
        } catch (err) {
            console.error('[Storage] createReceipt PGlite failed, trying Supabase:', err);
            const supabaseService = (await import('./supabaseService.js')).supabaseService;
            const result = await supabaseService.createReceipt({ id, ...receipt });
            window.dispatchEvent(new Event('refreshReceipts'));
            window.dispatchEvent(new Event('refreshDashboard'));
            return result.id || id;
        }

        window.dispatchEvent(new Event('refreshReceipts'));
        window.dispatchEvent(new Event('refreshDashboard'));

        return id;
    },

    async updateReceipt(id, updates) {
        await initDatabase();
        const now = new Date().toISOString();

        const setClause = [];
        const values = [];
        let paramIndex = 1;

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
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                let value = updates[key];
                if (['lineItems', 'splitData', 'recurringData'].includes(key)) {
                    value = JSON.stringify(value);
                }
                setClause.push(`${dbField} = $${paramIndex}`);
                values.push(value);
                paramIndex++;
            }
        }

        setClause.push(`updated_at = $${paramIndex}`);
        values.push(now);
        paramIndex++;

        setClause.push(`_synced = FALSE`);

        values.push(id);

        await db.query(
            `UPDATE receipts SET ${setClause.join(', ')} WHERE id = $${paramIndex}`,
            values
        );

        // Push to remote
        pushToRemote('receipts', 'update', { id, ...updates });

        window.dispatchEvent(new Event('refreshReceipts'));
        window.dispatchEvent(new Event('refreshDashboard'));

        return id;
    },

    async deleteReceipt(id) {
        await initDatabase();
        
        // Check if this is a demo receipt (don't push demo deletions to Supabase)
        let isDemo = false;
        if (db) {
            const result = await db.query(`SELECT is_demo FROM receipts WHERE id = $1`, [id]);
            isDemo = result.rows[0]?.is_demo || false;
        }
        
        await db.query(`DELETE FROM receipts WHERE id = $1`, [id]);

        // Only push to remote if not a demo receipt
        if (!isDemo) {
            pushToRemote('receipts', 'delete', { id });
        }

        window.dispatchEvent(new Event('refreshReceipts'));
        window.dispatchEvent(new Event('refreshDashboard'));
    },

    /**
     * Create a demo receipt (local-only, not synced to Supabase)
     */
    async createDemoReceipt(receipt) {
        const now = new Date().toISOString();
        const id = crypto.randomUUID();

        try {
            await initDatabase();
            if (!db) {
                console.warn('[Storage] PGlite not available, demo data cannot be created');
                return null;
            }

            await db.query(`
                INSERT INTO receipts (
                    id, user_id, merchant, date, total, currency, category, notes,
                    line_items, is_demo, is_pinned, transaction_type, group_id,
                    group_name, group_tags, split_data, recurring_data, created_at, updated_at, _synced
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, TRUE)
            `, [
                id,
                receipt.userId,
                receipt.merchant,
                receipt.date,
                receipt.total,
                receipt.currency || 'EUR',
                receipt.category,
                receipt.notes,
                JSON.stringify(receipt.lineItems || []),
                true, // Always true for demo receipts
                receipt.isPinned || false,
                receipt.transactionType || 'expense',
                receipt.groupId,
                receipt.groupName,
                receipt.groupTags || [],
                receipt.splitData ? JSON.stringify(receipt.splitData) : null,
                receipt.recurringData ? JSON.stringify(receipt.recurringData) : null,
                now,
                now
            ]);

            // Don't push to Supabase - demo data is local only
            console.log('[Storage] Created demo receipt locally (not synced):', id);
        } catch (err) {
            console.error('[Storage] createDemoReceipt failed:', err);
            return null;
        }

        window.dispatchEvent(new Event('refreshReceipts'));
        window.dispatchEvent(new Event('refreshDashboard'));

        return id;
    },

    /**
     * Clear all demo data (local-only operation)
     */
    async clearDemoData(userId) {
        await initDatabase();
        if (!db) {
            console.warn('[Storage] PGlite not available, cannot clear demo data');
            return 0;
        }

        try {
            // Get count of demo receipts
            const countResult = await db.query(
                `SELECT COUNT(*) as count FROM receipts WHERE user_id = $1 AND is_demo = TRUE`,
                [userId]
            );
            const count = parseInt(countResult.rows[0]?.count || 0);

            // Delete all demo receipts locally (no Supabase push needed)
            await db.query(`DELETE FROM receipts WHERE user_id = $1 AND is_demo = TRUE`, [userId]);

            console.log(`[Storage] Cleared ${count} demo receipts locally`);

            window.dispatchEvent(new Event('refreshReceipts'));
            window.dispatchEvent(new Event('refreshDashboard'));

            return count;
        } catch (err) {
            console.error('[Storage] clearDemoData failed:', err);
            return 0;
        }
    },

    _mapReceipt(row) {
        return {
            id: row.id,
            userId: row.user_id,
            merchant: row.merchant,
            date: row.date,
            total: parseFloat(row.total),
            currency: row.currency,
            category: row.category,
            notes: row.notes,
            lineItems: typeof row.line_items === 'string' ? JSON.parse(row.line_items) : row.line_items || [],
            isDemo: row.is_demo,
            isPinned: row.is_pinned,
            transactionType: row.transaction_type,
            groupId: row.group_id,
            groupName: row.group_name,
            groupTags: row.group_tags || [],
            splitData: typeof row.split_data === 'string' ? JSON.parse(row.split_data) : row.split_data,
            recurringData: typeof row.recurring_data === 'string' ? JSON.parse(row.recurring_data) : row.recurring_data,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            synced: row._synced,
        };
    },

    // ============================================
    // GROUPS
    // ============================================

    async getGroups(userId) {
        try {
            await initDatabase();
            if (!db) {
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                return await supabaseService.getGroups(userId);
            }
            const result = await db.query(
                `SELECT * FROM groups WHERE user_id = $1 ORDER BY is_pinned DESC, name ASC`,
                [userId]
            );
            return result.rows.map(this._mapGroup);
        } catch (err) {
            console.error('[Storage] getGroups failed, trying Supabase:', err);
            const supabaseService = (await import('./supabaseService.js')).supabaseService;
            return await supabaseService.getGroups(userId);
        }
    },

    async getGroup(id) {
        try {
            await initDatabase();
            if (!db) {
                return null; // No Supabase fallback for single group
            }
            const result = await db.query(`SELECT * FROM groups WHERE id = $1`, [id]);
            return result.rows[0] ? this._mapGroup(result.rows[0]) : null;
        } catch (err) {
            console.error('[Storage] getGroup failed:', err);
            return null;
        }
    },

    async createGroup(group) {
        const now = new Date().toISOString();
        const id = crypto.randomUUID();

        // Validate userId
        if (!group.userId) {
            console.error('[Storage] createGroup called without userId');
            throw new Error('userId is required to create a group');
        }

        try {
            await initDatabase();
            if (!db) {
                // Fallback to Supabase directly
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                const result = await supabaseService.createGroup(group.userId, group);
                window.dispatchEvent(new Event('refreshGroups'));
                return result?.id || id;
            }

            await db.query(`
                INSERT INTO groups (id, user_id, name, color, is_pinned, is_demo, parent_group_id, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                id,
                group.userId,
                group.name,
                group.color || '#6366f1',
                group.isPinned || false,
                group.isDemo || false,
                group.parentGroupId,
                now,
                now
            ]);

            pushToRemote('groups', 'insert', { id, ...group });
            window.dispatchEvent(new Event('refreshGroups'));

            return id;
        } catch (err) {
            console.error('[Storage] createGroup failed, trying Supabase:', err);
            const supabaseService = (await import('./supabaseService.js')).supabaseService;
            const result = await supabaseService.createGroup(group.userId, group);
            window.dispatchEvent(new Event('refreshGroups'));
            return result?.id || id;
        }
    },

    async updateGroup(id, updates) {
        await initDatabase();
        const now = new Date().toISOString();

        const setClause = [];
        const values = [];
        let paramIndex = 1;

        const fieldMap = {
            name: 'name',
            color: 'color',
            isPinned: 'is_pinned',
            isDemo: 'is_demo',
            parentGroupId: 'parent_group_id',
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                setClause.push(`${dbField} = $${paramIndex}`);
                values.push(updates[key]);
                paramIndex++;
            }
        }

        setClause.push(`updated_at = $${paramIndex}`);
        values.push(now);
        paramIndex++;

        values.push(id);

        await db.query(
            `UPDATE groups SET ${setClause.join(', ')} WHERE id = $${paramIndex}`,
            values
        );

        pushToRemote('groups', 'update', { id, ...updates });
        window.dispatchEvent(new Event('refreshGroups'));

        return id;
    },

    async deleteGroup(id) {
        await initDatabase();
        await db.query(`DELETE FROM groups WHERE id = $1`, [id]);

        pushToRemote('groups', 'delete', { id });
        window.dispatchEvent(new Event('refreshGroups'));
    },

    _mapGroup(row) {
        return {
            id: row.id,
            userId: row.user_id,
            name: row.name,
            color: row.color,
            isPinned: row.is_pinned,
            isDemo: row.is_demo,
            parentGroupId: row.parent_group_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            synced: row._synced,
        };
    },

    // ============================================
    // CATEGORIES
    // ============================================

    async getCategories(userId) {
        await initDatabase();
        const result = await db.query(
            `SELECT * FROM user_categories WHERE user_id = $1 ORDER BY name ASC`,
            [userId]
        );
        return result.rows.map(row => ({
            id: row.id,
            userId: row.user_id,
            name: row.name,
            color: row.color,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
    },

    async createCategory(category) {
        await initDatabase();
        const now = new Date().toISOString();
        const id = crypto.randomUUID();

        await db.query(`
            INSERT INTO user_categories (id, user_id, name, color, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id, name) DO NOTHING
        `, [id, category.userId, category.name, category.color || '#6366f1', now, now]);

        pushToRemote('user_categories', 'insert', { id, ...category });

        return id;
    },

    async updateCategory(id, updates) {
        await initDatabase();
        const now = new Date().toISOString();

        const setClause = [];
        const values = [];
        let paramIndex = 1;

        if (updates.name !== undefined) {
            setClause.push(`name = $${paramIndex}`);
            values.push(updates.name);
            paramIndex++;
        }
        if (updates.color !== undefined) {
            setClause.push(`color = $${paramIndex}`);
            values.push(updates.color);
            paramIndex++;
        }

        setClause.push(`updated_at = $${paramIndex}`);
        values.push(now);
        paramIndex++;

        values.push(id);

        await db.query(
            `UPDATE user_categories SET ${setClause.join(', ')} WHERE id = $${paramIndex}`,
            values
        );

        pushToRemote('user_categories', 'update', { id, ...updates });
        return id;
    },

    async deleteCategory(id) {
        await initDatabase();
        await db.query(`DELETE FROM user_categories WHERE id = $1`, [id]);
        pushToRemote('user_categories', 'delete', { id });
    },

    // ============================================
    // SETTINGS
    // ============================================

    async getSettings(userId) {
        try {
            await initDatabase();
            if (!db) {
                // Fallback to Supabase
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                return await supabaseService.getSettings(userId);
            }
            const result = await db.query(
                `SELECT * FROM settings WHERE user_id = $1`,
                [userId]
            );
            if (result.rows[0]) {
                const row = result.rows[0];
                return {
                    id: row.id,
                    userId: row.user_id,
                    ocrApiKey: row.ocr_api_key,
                    defaultCurrency: row.default_currency,
                };
            }
            // Local storage doesn't have settings - try Supabase as fallback
            console.log('[Storage] No local settings found, trying Supabase...');
            try {
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                const supabaseSettings = await supabaseService.getSettings(userId);
                if (supabaseSettings) {
                    // Cache the settings locally in background (don't block)
                    electricStorage.saveSettingsLocally(userId, supabaseSettings).catch(e => {
                        console.warn('[Storage] Failed to cache settings locally:', e);
                    });
                }
                return supabaseSettings;
            } catch (e) {
                console.error('[Storage] Supabase getSettings failed:', e);
                return null;
            }
        } catch (err) {
            console.error('[Storage] getSettings failed, trying Supabase:', err);
            try {
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                return await supabaseService.getSettings(userId);
            } catch (e) {
                console.error('[Storage] Supabase getSettings also failed:', e);
                return null;
            }
        }
    },

    // Helper to save settings to local storage only (no Supabase push)
    async saveSettingsLocally(userId, settings) {
        if (!db) return;
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        await db.query(`
            INSERT INTO settings (id, user_id, ocr_api_key, default_currency, created_at, updated_at, _synced)
            VALUES ($1, $2, $3, $4, $5, $6, TRUE)
            ON CONFLICT (user_id) DO UPDATE SET
                ocr_api_key = EXCLUDED.ocr_api_key,
                default_currency = EXCLUDED.default_currency,
                updated_at = EXCLUDED.updated_at,
                _synced = TRUE
        `, [id, userId, settings.ocrApiKey || null, settings.defaultCurrency || 'EUR', now, now]);
    },

    async saveSettings(userId, settings) {
        try {
            await initDatabase();
            if (!db) {
                // Fallback to Supabase
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                return await supabaseService.saveSettings(userId, settings);
            }

            const now = new Date().toISOString();
            const id = crypto.randomUUID();

            await db.query(`
                INSERT INTO settings (id, user_id, ocr_api_key, default_currency, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (user_id) DO UPDATE SET
                    ocr_api_key = $3,
                    default_currency = $4,
                    updated_at = $6
            `, [id, userId, settings.ocrApiKey, settings.defaultCurrency, now, now]);

            // Push to Supabase in background (don't block local save)
            (async () => {
                try {
                    const supabaseService = (await import('./supabaseService.js')).supabaseService;
                    await supabaseService.saveSettings(userId, settings);
                    console.log('[Storage] Settings synced to Supabase');
                } catch (e) {
                    console.error('[Storage] Failed to sync settings to Supabase:', e);
                    // Don't throw - local save succeeded
                }
            })();

            return id;
        } catch (err) {
            console.error('[Storage] saveSettings failed, trying Supabase:', err);
            const supabaseService = (await import('./supabaseService.js')).supabaseService;
            return await supabaseService.saveSettings(userId, settings);
        }
    },

    // ============================================
    // USER LAYOUT
    // ============================================

    async getUserLayout(userId) {
        try {
            await initDatabase();
            if (!db) {
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                return await supabaseService.getUserLayout(userId);
            }
            const result = await db.query(
                `SELECT * FROM user_layouts WHERE user_id = $1`,
                [userId]
            );
            if (result.rows[0]) {
                const row = result.rows[0];
                return {
                    id: row.id,
                    userId: row.user_id,
                    layout: typeof row.layout === 'string' ? JSON.parse(row.layout) : row.layout,
                };
            }
            return null;
        } catch (err) {
            console.error('[Storage] getUserLayout failed, trying Supabase:', err);
            try {
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                return await supabaseService.getUserLayout(userId);
            } catch (e) {
                console.error('[Storage] Supabase getUserLayout also failed:', e);
                return null;
            }
        }
    },

    async saveUserLayout(userId, layout) {
        try {
            await initDatabase();
            if (!db) {
                const supabaseService = (await import('./supabaseService.js')).supabaseService;
                return await supabaseService.saveUserLayout(userId, layout);
            }

            const now = new Date().toISOString();
            const id = crypto.randomUUID();

            await db.query(`
                INSERT INTO user_layouts (id, user_id, layout, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (user_id) DO UPDATE SET
                    layout = $3,
                    updated_at = $5
            `, [id, userId, JSON.stringify(layout), now, now]);

            pushToRemote('user_layouts', 'update', { userId, layout });
            window.dispatchEvent(new Event('refreshLayout'));

            return id;
        } catch (err) {
            console.error('[Storage] saveUserLayout failed, trying Supabase:', err);
            const supabaseService = (await import('./supabaseService.js')).supabaseService;
            return await supabaseService.saveUserLayout(userId, layout);
        }
    },

    // ============================================
    // SYNC UTILITIES
    // ============================================

    async clearAllData() {
        await initDatabase();
        if (!db) {
            console.log('[Storage] PGlite not available, nothing to clear locally');
            return;
        }
        await db.exec(`
            DELETE FROM receipts;
            DELETE FROM groups;
            DELETE FROM user_categories;
            DELETE FROM settings;
            DELETE FROM user_layouts;
        `);
        console.log('[Storage] All local data cleared');
    },

    async getSyncStatus(userId) {
        await initDatabase();
        if (!db) {
            return {
                receipts: { total: 0, synced: 0 },
                groups: { total: 0, synced: 0 },
            };
        }
        const receipts = await db.query(
            `SELECT COUNT(*) as total, SUM(CASE WHEN _synced THEN 1 ELSE 0 END) as synced FROM receipts WHERE user_id = $1`,
            [userId]
        );
        const groups = await db.query(
            `SELECT COUNT(*) as total, SUM(CASE WHEN _synced THEN 1 ELSE 0 END) as synced FROM groups WHERE user_id = $1`,
            [userId]
        );

        return {
            receipts: {
                total: parseInt(receipts.rows[0]?.total || 0),
                synced: parseInt(receipts.rows[0]?.synced || 0),
            },
            groups: {
                total: parseInt(groups.rows[0]?.total || 0),
                synced: parseInt(groups.rows[0]?.synced || 0),
            },
        };
    },

    /**
     * Force push all unsynced items to Supabase
     */
    async forcePush(userId) {
        await initDatabase();

        // If PGlite failed, nothing to push from local
        if (!db) {
            console.log('[Storage] PGlite not available, skipping push');
            return { pushed: 0, errors: [] };
        }

        const errors = [];
        let pushed = 0;

        console.log('[Storage] Pushing unsynced local changes to Supabase...');

        // Push unsynced receipts
        try {
            const unsyncedReceipts = await db.query(
                `SELECT * FROM receipts WHERE user_id = $1 AND _synced = FALSE`,
                [userId]
            );
            console.log(`[Storage] Found ${unsyncedReceipts.rows.length} unsynced receipts`);

            for (const row of unsyncedReceipts.rows) {
                try {
                    // Use upsert to handle both new items and updates
                    await pushToRemote('receipts', 'upsert', this._mapReceipt(row));
                    pushed++;
                } catch (err) {
                    console.error(`[Storage] Failed to push receipt ${row.id}:`, err);
                    errors.push({ type: 'receipt', id: row.id, error: err.message });
                }
            }
        } catch (err) {
            console.error('[Storage] Failed to query unsynced receipts:', err);
            errors.push({ type: 'receipts', error: err.message });
        }

        // Push unsynced groups
        try {
            const unsyncedGroups = await db.query(
                `SELECT * FROM groups WHERE user_id = $1 AND _synced = FALSE`,
                [userId]
            );
            console.log(`[Storage] Found ${unsyncedGroups.rows.length} unsynced groups`);

            for (const row of unsyncedGroups.rows) {
                try {
                    // Use upsert to handle both new items and updates
                    await pushToRemote('groups', 'upsert', this._mapGroup(row));
                    pushed++;
                } catch (err) {
                    console.error(`[Storage] Failed to push group ${row.id}:`, err);
                    errors.push({ type: 'group', id: row.id, error: err.message });
                }
            }
        } catch (err) {
            console.error('[Storage] Failed to query unsynced groups:', err);
            errors.push({ type: 'groups', error: err.message });
        }

        console.log(`[Storage] Push complete: ${pushed} items pushed, ${errors.length} errors`);
        return { pushed, errors };
    },

    /**
     * Pull all data from Supabase and upsert into local PGlite
     * This enables data from other devices to appear locally
     */
    async pullFromSupabase(userId) {
        await initDatabase();

        const supabaseService = (await import('./supabaseService.js')).supabaseService;

        if (!supabaseService.isConfigured()) {
            console.warn('[Storage] Supabase not configured, skipping pull');
            return { pulled: 0, updated: 0, errors: [] };
        }

        // If PGlite not available, skip pull (data will be read directly from Supabase)
        if (!db) {
            console.log('[Storage] PGlite not available, skipping local cache. Data will be read directly from Supabase.');
            return { pulled: 0, updated: 0, errors: [] };
        }

        const errors = [];
        let pulled = 0;
        let actuallyUpdated = 0;

        console.log('[Storage] Starting pull from Supabase for user:', userId);

        // Helper to check if receipt needs update (by comparing updated_at)
        const needsUpdate = async (table, id, newUpdatedAt) => {
            try {
                const result = await db.query(`SELECT updated_at FROM ${table} WHERE id = $1`, [id]);
                if (!result.rows[0]) return true; // New item, needs insert
                const localUpdatedAt = result.rows[0].updated_at;
                if (!localUpdatedAt || !newUpdatedAt) return true;
                return new Date(newUpdatedAt) > new Date(localUpdatedAt);
            } catch {
                return true;
            }
        };

        // Pull receipts (skip demo receipts - they are local only)
        try {
            console.log('[Storage] Fetching receipts from Supabase...');
            const receipts = await withTimeout(
                supabaseService.getReceiptsByUserId(userId),
                15000,
                'getReceiptsByUserId'
            );
            // Filter out any demo receipts that may have been accidentally synced
            const nonDemoReceipts = receipts.filter(r => !r.isDemo);
            console.log(`[Storage] Pulled ${nonDemoReceipts.length} receipts from Supabase (${receipts.length - nonDemoReceipts.length} demo receipts skipped)`);

            for (const receipt of nonDemoReceipts) {
                try {
                    // Check if this receipt needs updating
                    const shouldUpdate = await needsUpdate('receipts', receipt.id, receipt.updatedAt);
                    
                    await db.query(`
                        INSERT INTO receipts (
                            id, user_id, merchant, date, total, currency, category, notes,
                            line_items, is_demo, is_pinned, transaction_type, group_id,
                            group_name, group_tags, split_data, recurring_data, created_at, updated_at, _synced
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, TRUE)
                        ON CONFLICT (id) DO UPDATE SET
                            merchant = EXCLUDED.merchant,
                            date = EXCLUDED.date,
                            total = EXCLUDED.total,
                            currency = EXCLUDED.currency,
                            category = EXCLUDED.category,
                            notes = EXCLUDED.notes,
                            line_items = EXCLUDED.line_items,
                            is_demo = EXCLUDED.is_demo,
                            is_pinned = EXCLUDED.is_pinned,
                            transaction_type = EXCLUDED.transaction_type,
                            group_id = EXCLUDED.group_id,
                            group_name = EXCLUDED.group_name,
                            group_tags = EXCLUDED.group_tags,
                            split_data = EXCLUDED.split_data,
                            recurring_data = EXCLUDED.recurring_data,
                            updated_at = EXCLUDED.updated_at,
                            _synced = TRUE
                    `, [
                        receipt.id,
                        receipt.userId,
                        receipt.merchant,
                        receipt.date,
                        receipt.total,
                        receipt.currency || 'EUR',
                        receipt.category,
                        receipt.notes,
                        JSON.stringify(receipt.lineItems || []),
                        receipt.isDemo || false,
                        receipt.isPinned || false,
                        receipt.transactionType || 'expense',
                        receipt.groupId,
                        receipt.groupName,
                        receipt.groupTags || [],
                        receipt.splitData ? JSON.stringify(receipt.splitData) : null,
                        receipt.recurringData ? JSON.stringify(receipt.recurringData) : null,
                        receipt.createdAt || new Date().toISOString(),
                        receipt.updatedAt || new Date().toISOString()
                    ]);
                    pulled++;
                    if (shouldUpdate) actuallyUpdated++;
                } catch (err) {
                    console.error(`[Storage] Failed to upsert receipt ${receipt.id}:`, err);
                    errors.push({ type: 'receipt', id: receipt.id, error: err.message });
                }
            }
        } catch (err) {
            console.error('[Storage] Failed to pull receipts:', err);
            errors.push({ type: 'receipts', error: err.message });
        }

        // Pull groups
        try {
            console.log('[Storage] Fetching groups from Supabase...');
            const groups = await withTimeout(
                supabaseService.getGroups(userId),
                10000,
                'getGroups'
            );
            console.log(`[Storage] Pulled ${groups.length} groups from Supabase`);

            for (const group of groups) {
                try {
                    await db.query(`
                        INSERT INTO groups (id, user_id, name, color, is_pinned, is_demo, parent_group_id, created_at, updated_at, _synced)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
                        ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name,
                            color = EXCLUDED.color,
                            is_pinned = EXCLUDED.is_pinned,
                            is_demo = EXCLUDED.is_demo,
                            parent_group_id = EXCLUDED.parent_group_id,
                            updated_at = EXCLUDED.updated_at,
                            _synced = TRUE
                    `, [
                        group.id,
                        group.userId,
                        group.name,
                        group.color || '#6366f1',
                        group.isPinned || false,
                        group.isDemo || false,
                        group.parentGroupId,
                        group.createdAt || new Date().toISOString(),
                        group.updatedAt || new Date().toISOString()
                    ]);
                    pulled++;
                } catch (err) {
                    console.error(`[Storage] Failed to upsert group ${group.id}:`, err);
                    errors.push({ type: 'group', id: group.id, error: err.message });
                }
            }
        } catch (err) {
            console.error('[Storage] Failed to pull groups:', err);
            errors.push({ type: 'groups', error: err.message });
        }

        // Pull user categories
        try {
            console.log('[Storage] Fetching categories from Supabase...');
            const categories = await withTimeout(
                supabaseService.getUserCategories(userId),
                10000,
                'getUserCategories'
            );
            console.log(`[Storage] Pulled ${categories.length} categories from Supabase`);

            for (const category of categories) {
                try {
                    await db.query(`
                        INSERT INTO user_categories (id, user_id, name, color, created_at, updated_at, _synced)
                        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
                        ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name,
                            color = EXCLUDED.color,
                            updated_at = EXCLUDED.updated_at,
                            _synced = TRUE
                    `, [
                        category.id,
                        category.userId,
                        category.name,
                        category.color || '#6366f1',
                        category.createdAt || new Date().toISOString(),
                        category.updatedAt || new Date().toISOString()
                    ]);
                    pulled++;
                } catch (err) {
                    console.error(`[Storage] Failed to upsert category ${category.id}:`, err);
                    errors.push({ type: 'category', id: category.id, error: err.message });
                }
            }
        } catch (err) {
            console.error('[Storage] Failed to pull categories:', err);
            errors.push({ type: 'categories', error: err.message });
        }

        // Pull settings
        try {
            console.log('[Storage] Fetching settings from Supabase...');
            const settings = await withTimeout(
                supabaseService.getSettings(userId),
                10000,
                'getSettings'
            );
            if (settings) {
                console.log('[Storage] Pulled settings from Supabase');
                const now = new Date().toISOString();
                const id = crypto.randomUUID();

                await db.query(`
                    INSERT INTO settings (id, user_id, ocr_api_key, default_currency, created_at, updated_at, _synced)
                    VALUES ($1, $2, $3, $4, $5, $6, TRUE)
                    ON CONFLICT (user_id) DO UPDATE SET
                        ocr_api_key = EXCLUDED.ocr_api_key,
                        default_currency = EXCLUDED.default_currency,
                        updated_at = EXCLUDED.updated_at,
                        _synced = TRUE
                `, [
                    id,
                    userId,
                    settings.ocrApiKey,
                    settings.defaultCurrency || 'EUR',
                    now,
                    now
                ]);
                pulled++;
            }
        } catch (err) {
            console.error('[Storage] Failed to pull settings:', err);
            errors.push({ type: 'settings', error: err.message });
        }

        // Pull user layout
        try {
            console.log('[Storage] Fetching user layout from Supabase...');
            const layout = await withTimeout(
                supabaseService.getUserLayout(userId),
                10000,
                'getUserLayout'
            );
            if (layout) {
                console.log('[Storage] Pulled user layout from Supabase');
                const now = new Date().toISOString();
                const id = crypto.randomUUID();

                await db.query(`
                    INSERT INTO user_layouts (id, user_id, layout, created_at, updated_at, _synced)
                    VALUES ($1, $2, $3, $4, $5, TRUE)
                    ON CONFLICT (user_id) DO UPDATE SET
                        layout = EXCLUDED.layout,
                        updated_at = EXCLUDED.updated_at,
                        _synced = TRUE
                `, [
                    id,
                    userId,
                    JSON.stringify(layout),
                    now,
                    now
                ]);
                pulled++;
            }
        } catch (err) {
            console.error('[Storage] Failed to pull user layout:', err);
            errors.push({ type: 'user_layout', error: err.message });
        }

        // DELETION DETECTION: Remove local items that were synced but no longer exist in Supabase
        // Only delete items that: _synced = TRUE (was previously synced) AND _sync_failed = FALSE (not a failed sync)
        let deleted = 0;

        try {
            // Get all receipt IDs from Supabase
            const supabaseReceiptIds = new Set(
                (await supabaseService.getReceiptsByUserId(userId)).map(r => r.id)
            );

            // Find local receipts that were synced but no longer exist in Supabase
            const localSyncedReceipts = await db.query(
                `SELECT id FROM receipts WHERE user_id = $1 AND _synced = TRUE AND (_sync_failed = FALSE OR _sync_failed IS NULL) AND is_demo = FALSE`,
                [userId]
            );

            for (const row of localSyncedReceipts.rows) {
                if (!supabaseReceiptIds.has(row.id)) {
                    console.log(`[Storage] Deleting locally synced receipt ${row.id} - no longer exists in Supabase`);
                    await db.query(`DELETE FROM receipts WHERE id = $1`, [row.id]);
                    deleted++;
                }
            }

            // Get all group IDs from Supabase
            const supabaseGroupIds = new Set(
                (await supabaseService.getGroups(userId)).map(g => g.id)
            );

            // Find local groups that were synced but no longer exist in Supabase
            const localSyncedGroups = await db.query(
                `SELECT id FROM groups WHERE user_id = $1 AND _synced = TRUE AND (_sync_failed = FALSE OR _sync_failed IS NULL) AND is_demo = FALSE`,
                [userId]
            );

            for (const row of localSyncedGroups.rows) {
                if (!supabaseGroupIds.has(row.id)) {
                    console.log(`[Storage] Deleting locally synced group ${row.id} - no longer exists in Supabase`);
                    await db.query(`DELETE FROM groups WHERE id = $1`, [row.id]);
                    deleted++;
                }
            }

            if (deleted > 0) {
                console.log(`[Storage] Deleted ${deleted} items that no longer exist in Supabase`);
            }
        } catch (err) {
            console.error('[Storage] Failed to detect deletions:', err);
            errors.push({ type: 'deletion_detection', error: err.message });
        }

        console.log(`[Storage] Pull complete: ${pulled} items checked, ${actuallyUpdated} updated/new, ${deleted} deleted, ${errors.length} errors`);

        // Notify all listeners to refresh their data
        notifyListeners('receipts');
        notifyListeners('groups');
        notifyListeners('user_categories');
        notifyListeners('settings');
        notifyListeners('user_layouts');

        // Also dispatch refresh events - use setTimeout to ensure async UI updates
        setTimeout(() => {
            window.dispatchEvent(new Event('refreshReceipts'));
            window.dispatchEvent(new Event('refreshGroups'));
            window.dispatchEvent(new Event('refreshDashboard'));
            window.dispatchEvent(new Event('refreshLayout'));
        }, 100);

        return { pulled, updated: actuallyUpdated, deleted, errors };
    },

    /**
     * Clear all local data and resync from Supabase (Option 3 - Nuclear option)
     * Use this when sync state is corrupted or user wants a fresh start
     */
    async clearAndResync(userId) {
        console.log('[Storage] Starting clear and resync for user:', userId);

        await initDatabase();

        if (!db) {
            console.log('[Storage] PGlite not available, nothing to clear locally');
            return { cleared: 0, pulled: 0, errors: [] };
        }

        const errors = [];
        let cleared = 0;

        // Clear all local data for this user (except demo data which is local-only)
        try {
            console.log('[Storage] Clearing local receipts...');
            const receiptResult = await db.query(`DELETE FROM receipts WHERE user_id = $1 AND is_demo = FALSE`, [userId]);
            cleared += receiptResult.affectedRows || 0;

            console.log('[Storage] Clearing local groups...');
            const groupResult = await db.query(`DELETE FROM groups WHERE user_id = $1 AND is_demo = FALSE`, [userId]);
            cleared += groupResult.affectedRows || 0;

            console.log('[Storage] Clearing local categories...');
            await db.query(`DELETE FROM user_categories WHERE user_id = $1`, [userId]);

            console.log('[Storage] Clearing local settings...');
            await db.query(`DELETE FROM settings WHERE user_id = $1`, [userId]);

            console.log('[Storage] Clearing local layouts...');
            await db.query(`DELETE FROM user_layouts WHERE user_id = $1`, [userId]);

            console.log(`[Storage] Cleared local data`);
        } catch (err) {
            console.error('[Storage] Failed to clear local data:', err);
            errors.push({ type: 'clear', error: err.message });
        }

        // Pull fresh data from Supabase
        console.log('[Storage] Pulling fresh data from Supabase...');
        const pullResult = await this.pullFromSupabase(userId);

        console.log('[Storage] Clear and resync complete:', { cleared, pulled: pullResult.pulled });

        return {
            cleared,
            pulled: pullResult.pulled,
            errors: [...errors, ...pullResult.errors]
        };
    },

    /**
     * Full bidirectional sync - push local changes first, then pull from Supabase
     */
    async syncBidirectional(userId) {
        console.log('[Storage] Starting bidirectional sync for user:', userId);

        // IMPORTANT: Push first to avoid losing local changes
        // Then pull to get changes from other devices
        console.log('[Storage] Step 1: Pushing local changes to Supabase...');
        const pushResult = await this.forcePush(userId);

        console.log('[Storage] Step 2: Pulling changes from Supabase...');
        const pullResult = await this.pullFromSupabase(userId);

        const result = {
            downloaded: pullResult.pulled,
            updated: pullResult.updated || 0,
            uploaded: pushResult.pushed,
            errors: [...(pushResult.errors || []), ...pullResult.errors],
        };

        console.log('[Storage] Bidirectional sync complete:', result);
        return result;
    },
};

export default electricStorage;
