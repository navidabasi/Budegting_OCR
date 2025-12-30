import { storageService } from './storage';
import { validateEmail } from '../utils/helpers';

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

        // Check if user already exists
        const existingUser = await storageService.getUserByEmail(email);
        if (existingUser) {
            throw new Error('User with this email already exists');
        }

        // Create user
        const userId = await storageService.createUser({
            email,
            password // In production, hash this with bcrypt
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

        const user = await storageService.getUserByEmail(email);
        if (!user) {
            throw new Error('Invalid email or password');
        }

        // In production, compare hashed passwords
        if (user.password !== password) {
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

