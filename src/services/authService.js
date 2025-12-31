import { storageService } from './storage';
import { validateEmail } from '../utils/helpers';

// Lazy load supabaseService to avoid blocking initial load
const getSupabaseService = async () => {
    const module = await import('./supabaseService');
    return module.supabaseService;
};

// Dynamic import for bcryptjs to avoid browser bundling issues
const getBcrypt = async () => {
    try {
        const bcrypt = await import('bcryptjs');
        return bcrypt.default || bcrypt;
    } catch (error) {
        console.error('Failed to load bcryptjs:', error);
        throw new Error('Password hashing library failed to load');
    }
};

export const authService = {
    async register(email, password, veryfiApiKey = null) {
        if (!email || !password) {
            throw new Error('Email and password are required');
        }

        if (!validateEmail(email)) {
            throw new Error('Invalid email format');
        }

        if (password.length < 6) {
            throw new Error('Password must be at least 6 characters');
        }

        // Check if user already exists locally
        const existingLocalUser = await storageService.getUserByEmail(email);
        if (existingLocalUser) {
            throw new Error('User with this email already exists');
        }

        // Check if user exists in Supabase
        const supabaseService = await getSupabaseService();
        if (supabaseService.isConfigured()) {
            try {
                const existingCloudUser = await supabaseService.getUserByEmail(email);
                if (existingCloudUser) {
                    throw new Error('User with this email already exists');
                }
            } catch (error) {
                // Ignore "not found" errors (PGRST116)
                if (error.code !== 'PGRST116' && !error.message.includes('already exists')) {
                    console.error('Error checking Supabase:', error);
                } else if (error.message.includes('already exists')) {
                    throw error;
                }
            }
        }

        // Hash password
        const bcrypt = await getBcrypt();
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user (will sync to Supabase if configured)
        const userId = await storageService.createUser({
            email,
            password, // Keep for backward compatibility during migration
            passwordHash
        });

        // Save API key if provided
        if (veryfiApiKey) {
            await storageService.setVeryfiApiKey(userId, veryfiApiKey);
        }

        return { userId, email };
    },

    async login(email, password) {
        if (!email || !password) {
            throw new Error('Email and password are required');
        }

        // Try to find user locally first
        let user = await storageService.getUserByEmail(email);
        
        // If not found locally and Supabase is configured, try to sync from cloud
        const supabaseService = await getSupabaseService();
        if (!user && supabaseService.isConfigured()) {
            try {
                const cloudUser = await supabaseService.getUserByEmail(email);
                if (cloudUser) {
                    // User exists in cloud but not locally - this shouldn't happen normally
                    // but we'll handle it gracefully
                    throw new Error('User account found in cloud but not synced locally. Please try again.');
                }
            } catch (error) {
                // Ignore "not found" errors, but throw other errors
                if (error.message.includes('not synced locally')) {
                    throw error;
                }
                // Otherwise, continue with local-only login
            }
        }

        if (!user) {
            throw new Error('Invalid email or password');
        }

        // Check password
        let passwordValid = false;
        
        // If user has passwordHash, use bcrypt
        if (user.passwordHash) {
            const bcrypt = await getBcrypt();
            passwordValid = await bcrypt.compare(password, user.passwordHash);
        } else if (user.password) {
            // Legacy: compare plain text (for existing users)
            passwordValid = user.password === password;
            
            // Migrate to hashed password (we'll need to update via storageService)
            // This is a one-time migration that happens on login
            if (passwordValid) {
                const bcrypt = await getBcrypt();
                const passwordHash = await bcrypt.hash(password, 10);
                // Note: We'll need to add an updateUser method to storageService for this
                // For now, we'll just validate the password
            }
        }

        if (!passwordValid) {
            throw new Error('Invalid email or password');
        }

        return {
            userId: user.id,
            email: user.email
        };
    },

    async getUser(userId) {
        return await storageService.getUserById(userId);
    }
};

