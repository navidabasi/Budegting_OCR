import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './store/appStore';
import { authService } from './services/authService';
import { electricStorage } from './services/electricStorage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HomePage from './pages/HomePage';
import ReceiptsPage from './pages/ReceiptsPage';
import ReceiptDetailPage from './pages/ReceiptDetailPage';
import BottomNav from './components/layout/BottomNav';
import Sidebar from './components/layout/Sidebar';
import AddReceiptModal from './components/layout/AddReceiptModal';
import Toast from './components/common/Toast';
import InstallAppPrompt from './components/common/InstallAppPrompt';

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
    const darkModeManual = useAppStore((state) => state.darkModeManual);
    const applyDarkMode = useAppStore((state) => state.applyDarkMode);
    const electricInitialized = useRef(false);
    const showToastRef = useRef(showToast);

    // Keep showToast ref updated
    useEffect(() => {
        showToastRef.current = showToast;
    }, [showToast]);

    // Initialize PGlite storage when user authenticates
    useEffect(() => {
        const initStorage = async () => {
            if (currentUser?.userId && !electricInitialized.current) {
                try {
                    console.log('[App] Initializing PGlite storage...');

                    // Initialize PGlite local database (fast - just creates tables if needed)
                    await electricStorage.init(currentUser.userId);

                    electricInitialized.current = true;
                    console.log('[App] PGlite storage initialized');

                    // Trigger initial data load from local storage first (instant)
                    window.dispatchEvent(new CustomEvent('refreshDashboard'));
                    window.dispatchEvent(new CustomEvent('refreshReceipts'));
                    window.dispatchEvent(new CustomEvent('refreshGroups'));

                    // Sync with Supabase in background (non-blocking)
                    // Use setTimeout to let the UI render first
                    setTimeout(async () => {
                        console.log('[App] Starting background sync with Supabase...');
                        try {
                            const syncResult = await electricStorage.syncBidirectional(currentUser.userId);
                            console.log('[App] Background sync complete:', syncResult);
                            // Events are dispatched inside syncBidirectional
                        } catch (syncError) {
                            console.error('[App] Background sync failed:', syncError);
                            // Don't show error toast - app works with local data
                        }
                    }, 500);
                } catch (error) {
                    console.error('[App] Failed to initialize storage:', error);
                }
            }
        };

        initStorage();
    }, [currentUser?.userId]);

    // Reset Electric on logout
    useEffect(() => {
        if (!currentUser?.userId && electricInitialized.current) {
            electricInitialized.current = false;
        }
    }, [currentUser?.userId]);

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

                                // Initialize Electric and pull from Supabase
                                // (useEffect will handle full initialization, but we can start pulling early)
                                showToastRef.current('Signed in successfully', 'success');

                                // Trigger sync after sign-in if Electric is already initialized
                                if (electricInitialized.current) {
                                    try {
                                        console.log('[App] Pulling data after sign-in...');
                                        await electricStorage.pullFromSupabase(session.user.id);
                                    } catch (error) {
                                        console.error('[App] Post-signin sync failed:', error);
                                    }
                                }
                            } else if (event === 'SIGNED_OUT') {
                                setCurrentUser(null);
                                electricInitialized.current = false;
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
                        <InstallAppPrompt />
                    </>
                )}

                <Toast />
            </div>
        </BrowserRouter>
    );
}

export default App;
