import { storageService } from './storage';
import { validateEmail } from '../utils/helpers';

// Lazy load Supabase auth helpers to avoid blocking initial load
const getAuthHelpers = async () => {
    const module = await import('./supabaseService');
    return module.authHelpers;
};

export const authService = {
    async register(email, password, ocrApiKey = null) {
        if (!email || !password) {
            throw new Error('Email and password are required');
        }

        if (!validateEmail(email)) {
            throw new Error('Invalid email format');
        }

        if (password.length < 6) {
            throw new Error('Password must be at least 6 characters');
        }

        // Use Supabase Auth to create user
        const authHelpers = await getAuthHelpers();
        
        try {
            const { user, session } = await authHelpers.signUp(email, password);
            
            if (!user) {
                throw new Error('Failed to create user account');
            }

            // Save user info locally for offline access
            await storageService.createUser({
                email: user.email,
                supabaseId: user.id,
                supabaseUserId: user.id // Store Supabase user ID
            });

            // Save API key if provided (using Supabase user ID)
            if (ocrApiKey && user.id) {
                await storageService.setOcrApiKey(user.id, ocrApiKey);
            }

            return {
                userId: user.id,
                email: user.email,
                session: session
            };
        } catch (error) {
            // Handle Supabase Auth errors
            if (error.message.includes('already registered') || error.message.includes('already exists')) {
                throw new Error('User with this email already exists');
            }
            throw error;
        }
    },

    async login(email, password) {
        if (!email || !password) {
            throw new Error('Email and password are required');
        }

        // Use Supabase Auth to sign in
        const authHelpers = await getAuthHelpers();
        
        try {
            const { user, session } = await authHelpers.signIn(email, password);
            
            if (!user) {
                throw new Error('Invalid email or password');
            }

            // Save user info locally for offline access (if not already saved)
            const localUser = await storageService.getUserByEmail(email);
            if (!localUser) {
                await storageService.createUser({
                    email: user.email,
                    supabaseId: user.id,
                    supabaseUserId: user.id
                });
            }

            return {
                userId: user.id,
                email: user.email,
                session: session
            };
        } catch (error) {
            // Handle Supabase Auth errors
            if (error.message.includes('Invalid login credentials') || 
                error.message.includes('Email not confirmed')) {
                throw new Error('Invalid email or password');
            }
            throw error;
        }
    },

    async logout() {
        const authHelpers = await getAuthHelpers();
        try {
            await authHelpers.signOut();
        } catch (error) {
            console.error('Error signing out:', error);
            // Continue with logout even if Supabase signout fails
        }
    },

    async getUser(userId) {
        return await storageService.getUserById(userId);
    },

    async getCurrentSession() {
        const authHelpers = await getAuthHelpers();
        return await authHelpers.getSession();
    },

    async getCurrentUser() {
        const authHelpers = await getAuthHelpers();
        return await authHelpers.getUser();
    },

    async signInWithGoogle({ intent = 'signin' } = {}) {
        const authHelpers = await getAuthHelpers();
        const isSignUpIntent = intent === 'signup';
        const redirectUrl = new URL('/auth/callback', window.location.origin);
        redirectUrl.searchParams.set('intent', isSignUpIntent ? 'signup' : 'signin');

        try {
            const { data, error } = await authHelpers.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: redirectUrl.toString(),
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'consent',
                        ...(isSignUpIntent ? { screen_hint: 'signup' } : {})
                    }
                }
            });

            if (error) throw error;

            // Fallback for environments where automatic browser redirect doesn't occur.
            if (data?.url) {
                window.location.assign(data.url);
            }

            // OAuth redirects the user, so we don't return here
            return { redirecting: true, url: data?.url };
        } catch (error) {
            console.error('Google sign-in error:', error);
            throw new Error(error.message || 'Failed to sign in with Google');
        }
    },

    async signUpWithGoogle() {
        return this.signInWithGoogle({ intent: 'signup' });
    }
};
