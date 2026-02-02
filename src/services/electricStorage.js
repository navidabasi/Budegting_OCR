/**
 * Electric + PGlite Storage Service
 * Real-time sync with Supabase using Electric SQL
 */

import { PGlite } from '@electric-sql/pglite';
import { ShapeStream, Shape } from '@electric-sql/client';

// Configuration
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ELECTRIC_URL = import.meta.env.VITE_ELECTRIC_URL || `${SUPABASE_URL}/electric`;

// Database instance
let db = null;
let shapes = {};
let syncListeners = new Map();

/**
 * Initialize PGlite database with schema
 */
async function initDatabase() {
    if (db) return db;

    console.log('[Electric] Initializing PGlite database...');

    db = new PGlite('idb://receipts-electric', {
        // Enable relaxed durability for better performance
        relaxedDurability: true,
    });

    // Wait for database to be ready
    await db.waitReady;

    // Create schema matching Supabase
    await db.exec(`
        -- Enable UUID extension
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

        -- Receipts table
        CREATE TABLE IF NOT EXISTS receipts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
            _synced BOOLEAN DEFAULT FALSE
        );

        -- Groups table
        CREATE TABLE IF NOT EXISTS groups (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#6366f1',
            is_pinned BOOLEAN DEFAULT FALSE,
            is_demo BOOLEAN DEFAULT FALSE,
            parent_group_id UUID,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            _synced BOOLEAN DEFAULT FALSE
        );

        -- User categories table
        CREATE TABLE IF NOT EXISTS user_categories (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#6366f1',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            _synced BOOLEAN DEFAULT FALSE,
            UNIQUE(user_id, name)
        );

        -- Settings table
        CREATE TABLE IF NOT EXISTS settings (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID UNIQUE NOT NULL,
            ocr_api_key TEXT,
            default_currency TEXT DEFAULT 'EUR',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            _synced BOOLEAN DEFAULT FALSE
        );

        -- User layouts table
        CREATE TABLE IF NOT EXISTS user_layouts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID UNIQUE NOT NULL,
            layout JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            _synced BOOLEAN DEFAULT FALSE
        );

        -- Create indexes
        CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
        CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date);
        CREATE INDEX IF NOT EXISTS idx_receipts_synced ON receipts(_synced);
        CREATE INDEX IF NOT EXISTS idx_groups_user_id ON groups(user_id);
        CREATE INDEX IF NOT EXISTS idx_categories_user_id ON user_categories(user_id);
    `);

    console.log('[Electric] Database initialized');
    return db;
}

/**
 * Start Electric sync for a user
 */
async function startSync(userId, authToken) {
    if (!SUPABASE_URL) {
        console.warn('[Electric] Supabase URL not configured, running offline only');
        return;
    }

    console.log('[Electric] Starting sync for user:', userId);

    try {
        // Create shapes for each table
        const tables = ['receipts', 'groups', 'user_categories', 'settings', 'user_layouts'];

        for (const table of tables) {
            await syncTable(table, userId, authToken);
        }

        console.log('[Electric] Sync started for all tables');
    } catch (error) {
        console.error('[Electric] Sync initialization failed:', error);
    }
}

/**
 * Sync a single table using Electric Shapes
 */
async function syncTable(table, userId, authToken) {
    const shapeUrl = `${ELECTRIC_URL}/v1/shape`;

    try {
        const stream = new ShapeStream({
            url: shapeUrl,
            params: {
                table: table,
                where: `user_id = '${userId}'`,
            },
            headers: authToken ? {
                'Authorization': `Bearer ${authToken}`,
            } : {},
        });

        const shape = new Shape(stream);

        // Subscribe to changes
        shape.subscribe((messages) => {
            handleShapeMessages(table, messages);
        });

        shapes[table] = shape;
        console.log(`[Electric] Subscribed to ${table} shape`);
    } catch (error) {
        console.error(`[Electric] Failed to sync ${table}:`, error);
    }
}

/**
 * Handle incoming shape messages (sync updates)
 */
async function handleShapeMessages(table, messages) {
    if (!db) return;

    for (const message of messages) {
        try {
            if (message.headers?.operation === 'insert') {
                await upsertFromRemote(table, message.value);
            } else if (message.headers?.operation === 'update') {
                await upsertFromRemote(table, message.value);
            } else if (message.headers?.operation === 'delete') {
                await deleteFromRemote(table, message.key);
            }
        } catch (error) {
            console.error(`[Electric] Error processing ${table} message:`, error);
        }
    }

    // Notify listeners
    notifyListeners(table);
}

/**
 * Upsert a record from remote sync
 */
async function upsertFromRemote(table, data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const updates = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');

    await db.query(`
        INSERT INTO ${table} (${columns.join(', ')})
        VALUES (${placeholders})
        ON CONFLICT (id) DO UPDATE SET ${updates}, _synced = TRUE
    `, values);
}

/**
 * Delete a record from remote sync
 */
async function deleteFromRemote(table, key) {
    if (key?.id) {
        await db.query(`DELETE FROM ${table} WHERE id = $1`, [key.id]);
    }
}

/**
 * Push local changes to Supabase
 */
async function pushToRemote(table, operation, data) {
    if (!SUPABASE_URL) return;

    const supabaseService = await import('./supabaseService.js');

    try {
        if (operation === 'insert') {
            await supabaseService.default[`create${capitalizeFirst(singularize(table))}`](data);
        } else if (operation === 'update') {
            await supabaseService.default[`update${capitalizeFirst(singularize(table))}`](data.id, data);
        } else if (operation === 'delete') {
            await supabaseService.default[`delete${capitalizeFirst(singularize(table))}`](data.id);
        }

        // Mark as synced
        await db.query(`UPDATE ${table} SET _synced = TRUE WHERE id = $1`, [data.id]);
    } catch (error) {
        console.error(`[Electric] Failed to push ${operation} to ${table}:`, error);
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
     * Initialize the storage and optionally start sync
     */
    async init(userId = null, authToken = null) {
        await initDatabase();

        if (userId) {
            await startSync(userId, authToken);
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
        await initDatabase();
        const result = await db.query(
            `SELECT * FROM receipts WHERE user_id = $1 ORDER BY date DESC, created_at DESC`,
            [userId]
        );
        return result.rows.map(this._mapReceipt);
    },

    async getReceipt(id) {
        await initDatabase();
        const result = await db.query(`SELECT * FROM receipts WHERE id = $1`, [id]);
        return result.rows[0] ? this._mapReceipt(result.rows[0]) : null;
    },

    async createReceipt(receipt) {
        await initDatabase();
        const now = new Date().toISOString();
        const id = crypto.randomUUID();

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
        await db.query(`DELETE FROM receipts WHERE id = $1`, [id]);

        // Push to remote
        pushToRemote('receipts', 'delete', { id });

        window.dispatchEvent(new Event('refreshReceipts'));
        window.dispatchEvent(new Event('refreshDashboard'));
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
        await initDatabase();
        const result = await db.query(
            `SELECT * FROM groups WHERE user_id = $1 ORDER BY is_pinned DESC, name ASC`,
            [userId]
        );
        return result.rows.map(this._mapGroup);
    },

    async createGroup(group) {
        await initDatabase();
        const now = new Date().toISOString();
        const id = crypto.randomUUID();

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

    async deleteCategory(id) {
        await initDatabase();
        await db.query(`DELETE FROM user_categories WHERE id = $1`, [id]);
        pushToRemote('user_categories', 'delete', { id });
    },

    // ============================================
    // SETTINGS
    // ============================================

    async getSettings(userId) {
        await initDatabase();
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
        return null;
    },

    async saveSettings(userId, settings) {
        await initDatabase();
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

        pushToRemote('settings', 'update', { userId, ...settings });

        return id;
    },

    // ============================================
    // USER LAYOUT
    // ============================================

    async getUserLayout(userId) {
        await initDatabase();
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
    },

    async saveUserLayout(userId, layout) {
        await initDatabase();
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
    },

    // ============================================
    // SYNC UTILITIES
    // ============================================

    async clearAllData() {
        await initDatabase();
        await db.exec(`
            DELETE FROM receipts;
            DELETE FROM groups;
            DELETE FROM user_categories;
            DELETE FROM settings;
            DELETE FROM user_layouts;
        `);
        console.log('[Electric] All local data cleared');
    },

    async getSyncStatus(userId) {
        await initDatabase();
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
     * Force sync all unsynced items
     */
    async forcePush(userId) {
        await initDatabase();

        // Get unsynced receipts
        const unsynced = await db.query(
            `SELECT * FROM receipts WHERE user_id = $1 AND _synced = FALSE`,
            [userId]
        );

        for (const row of unsynced.rows) {
            await pushToRemote('receipts', 'update', this._mapReceipt(row));
        }

        return { pushed: unsynced.rows.length };
    },

    /**
     * Pull all data from Supabase and upsert into local PGlite
     * This enables data from other devices to appear locally
     */
    async pullFromSupabase(userId) {
        await initDatabase();

        const supabaseService = (await import('./supabaseService.js')).supabaseService;

        if (!supabaseService.isConfigured()) {
            console.warn('[Electric] Supabase not configured, skipping pull');
            return { pulled: 0, errors: [] };
        }

        const errors = [];
        let pulled = 0;

        console.log('[Electric] Starting pull from Supabase for user:', userId);

        // Pull receipts
        try {
            const receipts = await supabaseService.getReceiptsByUserId(userId);
            console.log(`[Electric] Pulled ${receipts.length} receipts from Supabase`);

            for (const receipt of receipts) {
                try {
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
                } catch (err) {
                    console.error(`[Electric] Failed to upsert receipt ${receipt.id}:`, err);
                    errors.push({ type: 'receipt', id: receipt.id, error: err.message });
                }
            }
        } catch (err) {
            console.error('[Electric] Failed to pull receipts:', err);
            errors.push({ type: 'receipts', error: err.message });
        }

        // Pull groups
        try {
            const groups = await supabaseService.getGroups(userId);
            console.log(`[Electric] Pulled ${groups.length} groups from Supabase`);

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
                    console.error(`[Electric] Failed to upsert group ${group.id}:`, err);
                    errors.push({ type: 'group', id: group.id, error: err.message });
                }
            }
        } catch (err) {
            console.error('[Electric] Failed to pull groups:', err);
            errors.push({ type: 'groups', error: err.message });
        }

        // Pull user categories
        try {
            const categories = await supabaseService.getUserCategories(userId);
            console.log(`[Electric] Pulled ${categories.length} categories from Supabase`);

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
                    console.error(`[Electric] Failed to upsert category ${category.id}:`, err);
                    errors.push({ type: 'category', id: category.id, error: err.message });
                }
            }
        } catch (err) {
            console.error('[Electric] Failed to pull categories:', err);
            errors.push({ type: 'categories', error: err.message });
        }

        // Pull settings
        try {
            const settings = await supabaseService.getSettings(userId);
            if (settings) {
                console.log('[Electric] Pulled settings from Supabase');
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
            console.error('[Electric] Failed to pull settings:', err);
            errors.push({ type: 'settings', error: err.message });
        }

        // Pull user layout
        try {
            const layout = await supabaseService.getUserLayout(userId);
            if (layout) {
                console.log('[Electric] Pulled user layout from Supabase');
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
            console.error('[Electric] Failed to pull user layout:', err);
            errors.push({ type: 'user_layout', error: err.message });
        }

        console.log(`[Electric] Pull complete: ${pulled} items synced, ${errors.length} errors`);

        // Notify all listeners to refresh their data
        notifyListeners('receipts');
        notifyListeners('groups');
        notifyListeners('user_categories');
        notifyListeners('settings');
        notifyListeners('user_layouts');

        // Also dispatch refresh events
        window.dispatchEvent(new Event('refreshReceipts'));
        window.dispatchEvent(new Event('refreshGroups'));
        window.dispatchEvent(new Event('refreshDashboard'));
        window.dispatchEvent(new Event('refreshLayout'));

        return { pulled, errors };
    },

    /**
     * Full bidirectional sync - pull from Supabase then push local changes
     */
    async syncBidirectional(userId) {
        console.log('[Electric] Starting bidirectional sync for user:', userId);

        // First pull from Supabase to get remote changes
        const pullResult = await this.pullFromSupabase(userId);

        // Then push any local unsynced changes
        const pushResult = await this.forcePush(userId);

        return {
            downloaded: pullResult.pulled,
            uploaded: pushResult.pushed,
            errors: pullResult.errors,
        };
    },
};

export default electricStorage;
