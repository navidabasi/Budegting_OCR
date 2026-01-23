import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './store/appStore';
import { authService } from './services/authService';
import { storageService } from './services/storage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HomePage from './pages/HomePage';
import ReceiptsPage from './pages/ReceiptsPage';
import ReceiptDetailPage from './pages/ReceiptDetailPage';
import BottomNav from './components/layout/BottomNav';
import Sidebar from './components/layout/Sidebar';
import AddReceiptModal from './components/layout/AddReceiptModal';
import Toast from './components/common/Toast';

function ProtectedRoute({ children }) {
    const isAuthenticated = useAppStore((state) => state.isAuthenticated);
    return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
    const isAuthenticated = useAppStore((state) => state.isAuthenticated);
    return !isAuthenticated ? children : <Navigate to="/" replace />;
}

function App() {
    const isAuthenticated = useAppStore((state) => state.isAuthenticated);
    const setCurrentUser = useAppStore((state) => state.setCurrentUser);
    const currentUser = useAppStore((state) => state.currentUser);
    const showToast = useAppStore((state) => state.showToast);
    const darkMode = useAppStore((state) => state.darkMode);
    const initializeDarkMode = useAppStore((state) => state.initializeDarkMode);
    const getSystemDarkMode = useAppStore((state) => state.getSystemDarkMode);
    const darkModeManual = useAppStore((state) => state.darkModeManual);
    const applyDarkMode = useAppStore((state) => state.applyDarkMode);
    const syncIntervalRef = useRef(null);
    const lastSyncRef = useRef(null);
    const showToastRef = useRef(showToast);
    
    // Keep showToast ref updated
    useEffect(() => {
        showToastRef.current = showToast;
    }, [showToast]);

    // Auto-sync from cloud function
    const syncFromCloud = async (userId, silent = true) => {
        try {
            const result = await storageService.syncAllFromCloud(userId);
            if (!silent && result.synced > 0) {
                if (result.errors.length > 0) {
                    console.warn(`[Auto Sync] Synced ${result.synced} items, ${result.errors.length} errors`);
                } else {
                    console.log(`[Auto Sync] Synced ${result.synced} items from cloud`);
                    // Only show toast if items were synced
                    if (result.synced > 0) {
                        showToast(`Synced ${result.synced} new item${result.synced > 1 ? 's' : ''} from cloud`, 'success');
                        // Trigger refresh on pages that display receipts
                        window.dispatchEvent(new CustomEvent('refreshDashboard'));
                        window.dispatchEvent(new CustomEvent('refreshReceipts'));
                        // Also trigger a refresh for groups
                        window.dispatchEvent(new CustomEvent('refreshGroups'));
                    }
                }
            }
            lastSyncRef.current = Date.now();
            return result;
        } catch (error) {
            console.error('[Auto Sync] Failed to sync from cloud:', error);
            return { synced: 0, errors: [error.message] };
        }
    };

    // Check for existing Supabase session on mount and handle OAuth callback
    useEffect(() => {
        const checkSession = async () => {
            try {
                // Check for OAuth callback in URL
                const urlParams = new URLSearchParams(window.location.search);
                const hash = window.location.hash;
                const hasOAuthCallback = urlParams.has('code') || hash.includes('access_token') || hash.includes('type=recovery');

                if (hasOAuthCallback) {
                    // OAuth callback detected - Supabase will handle it via auth state change
                    // Clean up URL
                    window.history.replaceState({}, document.title, window.location.pathname);
                }

                const session = await authService.getCurrentSession();
                if (session?.user) {
                    setCurrentUser({
                        userId: session.user.id,
                        email: session.user.email
                    });
                    
                    // Save user locally if not already saved
                    try {
                        const localUser = await storageService.getUserByEmail(session.user.email);
                        if (!localUser) {
                            await storageService.createUser({
                                email: session.user.email,
                                supabaseId: session.user.id,
                                supabaseUserId: session.user.id
                            });
                        }
                    } catch (err) {
                        console.error('Failed to save user locally:', err);
                    }
                }
            } catch (error) {
                console.error('Error checking session:', error);
            }
        };

        checkSession();

        // Listen for auth state changes
        const setupAuthListener = async () => {
            try {
                const { supabase, authHelpers } = await import('./services/supabaseService');
                if (supabase) {
                    const { data: { subscription } } = authHelpers.onAuthStateChange(
                        async (event, session) => {
                            if (event === 'SIGNED_IN' && session?.user) {
                                setCurrentUser({
                                    userId: session.user.id,
                                    email: session.user.email
                                });
                                
                                // Save user locally if not already saved (for OAuth users)
                                try {
                                    const localUser = await storageService.getUserByEmail(session.user.email);
                                    if (!localUser) {
                                        await storageService.createUser({
                                            email: session.user.email,
                                            supabaseId: session.user.id,
                                            supabaseUserId: session.user.id
                                        });
                                    }
                                } catch (err) {
                                    console.error('Failed to save user locally:', err);
                                }
                                
                                // Force sync from cloud on sign in
                                try {
                                    const result = await storageService.syncAllFromCloud(session.user.id);
                                    if (result.synced > 0) {
                                        showToastRef.current(`Synced ${result.synced} item${result.synced > 1 ? 's' : ''} from cloud`, 'success');
                                        // Trigger refresh
                                        window.dispatchEvent(new CustomEvent('refreshDashboard'));
                                        window.dispatchEvent(new CustomEvent('refreshReceipts'));
                                        // Also trigger a refresh for groups specifically
                                        window.dispatchEvent(new CustomEvent('refreshGroups'));
                                    }
                                } catch (syncError) {
                                    console.error('Failed to sync from cloud on sign in:', syncError);
                                    // Don't show error to user, sync will retry automatically
                                }
                            } else if (event === 'SIGNED_OUT') {
                                setCurrentUser(null);
                            }
                        }
                    );
                    return () => subscription?.unsubscribe();
                }
            } catch (error) {
                console.error('Error setting up auth listener:', error);
            }
        };

        setupAuthListener();
    }, [setCurrentUser]);

    // Auto-sync from cloud when user is authenticated
    useEffect(() => {
        if (!currentUser?.userId) {
            // Clear interval if user logs out
            if (syncIntervalRef.current) {
                clearInterval(syncIntervalRef.current);
                syncIntervalRef.current = null;
            }
            return;
        }

        // Initial sync when app loads
        syncFromCloud(currentUser.userId, true);

        // Set up periodic sync (every 5 minutes)
        syncIntervalRef.current = setInterval(() => {
            syncFromCloud(currentUser.userId, true);
        }, 300000); // 5 minutes

        // Sync when user returns to the app (Page Visibility API)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                // User switched back to the app, sync from cloud
                const timeSinceLastSync = lastSyncRef.current ? Date.now() - lastSyncRef.current : Infinity;
                // Only sync if it's been more than 5 seconds since last sync
                if (timeSinceLastSync > 5000) {
                    syncFromCloud(currentUser.userId, false);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Sync when window gains focus
        const handleFocus = () => {
            const timeSinceLastSync = lastSyncRef.current ? Date.now() - lastSyncRef.current : Infinity;
            if (timeSinceLastSync > 5000) {
                syncFromCloud(currentUser.userId, false);
            }
        };

        window.addEventListener('focus', handleFocus);

        return () => {
            if (syncIntervalRef.current) {
                clearInterval(syncIntervalRef.current);
            }
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleFocus);
        };
    }, [currentUser?.userId]);

    // Initialize dark mode on mount
    useEffect(() => {
        initializeDarkMode();
    }, [initializeDarkMode]);

    // Listen for system preference changes (only if not manually set)
    useEffect(() => {
        if (darkModeManual !== null) {
            // User has manually set preference, don't listen to system changes
            return;
        }

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        const handleSystemChange = (e) => {
            const systemDarkMode = e.matches;
            applyDarkMode(systemDarkMode);
            useAppStore.setState({ darkMode: systemDarkMode });
        };

        // Modern browsers
        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', handleSystemChange);
            return () => mediaQuery.removeEventListener('change', handleSystemChange);
        } 
        // Fallback for older browsers
        else if (mediaQuery.addListener) {
            mediaQuery.addListener(handleSystemChange);
            return () => mediaQuery.removeListener(handleSystemChange);
        }
    }, [darkModeManual, applyDarkMode]);

    return (
        <BrowserRouter>
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
                <Routes>
                    <Route
                        path="/login"
                        element={
                            <PublicRoute>
                                <LoginPage />
                            </PublicRoute>
                        }
                    />
                    <Route
                        path="/register"
                        element={
                            <PublicRoute>
                                <RegisterPage />
                            </PublicRoute>
                        }
                    />
                    <Route
                        path="/"
                        element={
                            <ProtectedRoute>
                                <HomePage />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/receipts"
                        element={
                            <ProtectedRoute>
                                <ReceiptsPage />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/receipts/:id"
                        element={
                            <ProtectedRoute>
                                <ReceiptDetailPage />
                            </ProtectedRoute>
                        }
                    />
                </Routes>

                {isAuthenticated && (
                    <>
                        <BottomNav />
                        <Sidebar />
                        <AddReceiptModal />
                    </>
                )}

                <Toast />
            </div>
        </BrowserRouter>
    );
}

export default App;

