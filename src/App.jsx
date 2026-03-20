import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

function ScrollToTop() {
    const { pathname } = useLocation();
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [pathname]);
    return null;
}
import { useAppStore } from './store/appStore';
import { authService } from './services/authService';
import { electricStorage } from './services/electricStorage';
import { storageService } from './services/storage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HomePage from './pages/HomePage';
import LandingPage from './pages/LandingPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import ReceiptsPage from './pages/ReceiptsPage';
import ReceiptDetailPage from './pages/ReceiptDetailPage';
import BottomNav from './components/layout/BottomNav';
import Sidebar from './components/layout/Sidebar';
import AddReceiptModal from './components/layout/AddReceiptModal';
import Toast from './components/common/Toast';
import InstallAppPrompt from './components/common/InstallAppPrompt';
import { detectDeviceLanguage, normalizeLanguageCode } from './languages';
import { useTranslation } from './languages/useTranslation';

function ProtectedRoute({ children }) {
    const isAuthenticated = useAppStore((state) => state.isAuthenticated);
    return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
    const isAuthenticated = useAppStore((state) => state.isAuthenticated);
    return !isAuthenticated ? children : <Navigate to="/" replace />;
}

function App() {
    const { t } = useTranslation();
    const isAuthenticated = useAppStore((state) => state.isAuthenticated);
    const setCurrentUser = useAppStore((state) => state.setCurrentUser);
    const currentUser = useAppStore((state) => state.currentUser);
    const storageHealth = useAppStore((state) => state.storageHealth);
    const setStorageHealth = useAppStore((state) => state.setStorageHealth);
    const showToast = useAppStore((state) => state.showToast);
    const darkMode = useAppStore((state) => state.darkMode);
    const initializeDarkMode = useAppStore((state) => state.initializeDarkMode);
    const darkModeManual = useAppStore((state) => state.darkModeManual);
    const applyDarkMode = useAppStore((state) => state.applyDarkMode);
    const languageCode = useAppStore((state) => state.languageCode);
    const setLanguageCode = useAppStore((state) => state.setLanguageCode);
    const electricInitialized = useRef(false);
    const syncInProgressRef = useRef(false);
    const storageWarningShownRef = useRef(false);
    const showToastRef = useRef(showToast);
    const [isRecoveringStorage, setIsRecoveringStorage] = useState(false);

    const handleRefreshStorage = async () => {
        if (!currentUser?.userId || isRecoveringStorage) return;

        if (!navigator.onLine) {
            showToastRef.current(t('app.offlineWarning'), 'warning');
            return;
        }

        setIsRecoveringStorage(true);
        try {
            await electricStorage.init(currentUser.userId, { force: true });
            const health = electricStorage.getStorageHealth();
            setStorageHealth(health);

            if (health.hasLocalCache) {
                storageWarningShownRef.current = false;
                showToastRef.current(t('app.cacheRestored'), 'success');
                window.dispatchEvent(new CustomEvent('refreshDashboard'));
                window.dispatchEvent(new CustomEvent('refreshReceipts'));
                window.dispatchEvent(new CustomEvent('refreshGroups'));
            } else {
                showToastRef.current(t('app.cloudOnlyWarning'), 'warning');
            }
        } catch (error) {
            console.error('[App] Manual storage refresh failed:', error);
            showToastRef.current(t('app.refreshFailed'), 'error');
        } finally {
            setIsRecoveringStorage(false);
        }
    };

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

                    const storageHealth = electricStorage.getStorageHealth();
                    setStorageHealth(storageHealth);
                    if (!storageHealth.hasLocalCache && !storageWarningShownRef.current) {
                        showToastRef.current(t('app.offlineModeLimited'), 'warning');
                        storageWarningShownRef.current = true;
                    } else if (storageHealth.hasLocalCache) {
                        storageWarningShownRef.current = false;
                    }

                    // Trigger initial data load from local storage first (instant)
                    window.dispatchEvent(new CustomEvent('refreshDashboard'));
                    window.dispatchEvent(new CustomEvent('refreshReceipts'));
                    window.dispatchEvent(new CustomEvent('refreshGroups'));
                } catch (error) {
                    console.error('[App] Failed to initialize storage:', error);
                    setStorageHealth({
                        hasLocalCache: false,
                        initFailed: true,
                        fallbackMode: true,
                        lastError: error?.message || 'Storage initialization failed'
                    });
                }
            }
        };

        initStorage();
    }, [currentUser?.userId, setStorageHealth]);

    // Reset Electric on logout
    useEffect(() => {
        if (!currentUser?.userId && electricInitialized.current) {
            electricInitialized.current = false;
            syncInProgressRef.current = false;
            storageWarningShownRef.current = false;
            setStorageHealth({
                hasLocalCache: true,
                initFailed: false,
                fallbackMode: false,
                lastError: null,
                lastAttemptAt: null
            });
        }
    }, [currentUser?.userId, setStorageHealth]);

    // Sync lifecycle: startup, online/focus/visibility, and periodic sync every 5 minutes
    useEffect(() => {
        if (!currentUser?.userId) return;

        let disposed = false;

        const runSync = async (reason) => {
            if (disposed || !currentUser?.userId || !navigator.onLine || syncInProgressRef.current) {
                return;
            }

            syncInProgressRef.current = true;
            try {
                console.log(`[App] Starting sync (${reason})...`);
                const shouldForceRetry = reason === 'online' || reason === 'focus' || reason === 'visibility' || reason === 'manual';
                await electricStorage.init(currentUser.userId, { force: shouldForceRetry });
                const health = electricStorage.getStorageHealth();
                setStorageHealth(health);
                if (health.hasLocalCache) {
                    storageWarningShownRef.current = false;
                }
                await electricStorage.syncBidirectional(currentUser.userId);
            } catch (error) {
                console.error(`[App] Sync failed (${reason}):`, error);
            } finally {
                syncInProgressRef.current = false;
            }
        };

        const handleOnline = () => runSync('online');
        const handleFocus = () => runSync('focus');
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                runSync('visibility');
            }
        };

        const syncInterval = setInterval(() => runSync('interval'), 5 * 60 * 1000);
        runSync('startup');

        window.addEventListener('online', handleOnline);
        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            disposed = true;
            clearInterval(syncInterval);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [currentUser?.userId, setStorageHealth]);

    // Check for existing Supabase session on mount
    useEffect(() => {
        let isMounted = true;
        let unsubscribeAuth = null;

        const checkSession = async () => {
            try {
                const session = await authService.getCurrentSession();
                if (isMounted && session?.user) {
                    setCurrentUser({
                        userId: session.user.id,
                        email: session.user.email
                    });
                }
            } catch (error) {
                console.error('Error checking session:', error);
            }
        };

        // Listen for auth state changes
        const setupAuthListener = async () => {
            try {
                const { supabase, authHelpers } = await import('./services/supabaseService');
                if (!supabase) return;

                const { data: { subscription } } = authHelpers.onAuthStateChange(
                    async (event, session) => {
                        if (event === 'SIGNED_IN' && session?.user) {
                            setCurrentUser({
                                userId: session.user.id,
                                email: session.user.email
                            });

                            // Initialize Electric and pull from Supabase
                            // (useEffect will handle full initialization, but we can start pulling early)
                            showToastRef.current(t('app.signedInSuccess'), 'success');

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
                            // Only clear auth state if actually online — offline token
                            // validation failures should not log the user out
                            if (navigator.onLine) {
                                setCurrentUser(null);
                                electricInitialized.current = false;
                            }
                        }
                    }
                );

                unsubscribeAuth = () => subscription?.unsubscribe();
            } catch (error) {
                console.error('Error setting up auth listener:', error);
            }
        };

        checkSession();
        setupAuthListener();

        return () => {
            isMounted = false;
            if (unsubscribeAuth) unsubscribeAuth();
        };
    }, [setCurrentUser]);

    // Initialize dark mode on mount
    useEffect(() => {
        initializeDarkMode();
    }, [initializeDarkMode]);

    // Initialize language (account setting > local cached > device language)
    useEffect(() => {
        let isMounted = true;

        const initializeLanguage = async () => {
            const deviceLanguage = detectDeviceLanguage();
            const localLanguage = normalizeLanguageCode(languageCode || '', '');

            if (!currentUser?.userId) {
                const fallbackLanguage = localLanguage || deviceLanguage;
                if (isMounted) {
                    setLanguageCode(fallbackLanguage);
                }
                return;
            }

            // Pull latest cloud settings first so language stays in sync across devices.
            if (typeof navigator !== 'undefined' && navigator.onLine) {
                try {
                    await electricStorage.pullFromSupabase(currentUser.userId);
                } catch (err) {
                    console.warn('[App] Failed to pull latest settings before language init:', err);
                }
            }

            let accountLanguage = '';
            let accountLanguageLoaded = false;
            try {
                accountLanguage = normalizeLanguageCode(await storageService.getLanguage(currentUser.userId), '');
                accountLanguageLoaded = true;
            } catch (err) {
                console.warn('[App] Failed to read language from settings:', err);
            }

            const resolvedLanguage = accountLanguage || localLanguage || deviceLanguage;
            if (!isMounted) return;

            setLanguageCode(resolvedLanguage);

            // Persist only when there is no account value yet.
            if (accountLanguageLoaded && !accountLanguage) {
                try {
                    await storageService.setLanguage(currentUser.userId, resolvedLanguage);
                } catch (err) {
                    console.warn('[App] Failed to persist detected language:', err);
                }
            }
        };

        initializeLanguage();

        return () => {
            isMounted = false;
        };
    }, [currentUser?.userId, setLanguageCode]);

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
            <ScrollToTop />
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
                {isAuthenticated && storageHealth?.fallbackMode && (
                    <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs sm:text-sm text-amber-900 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200">
                        <div className="flex items-start justify-between gap-3">
                            <p className="leading-5">
                                {t('app.cacheUnavailableBanner')}
                            </p>
                            <button
                                type="button"
                                onClick={handleRefreshStorage}
                                disabled={isRecoveringStorage}
                                className="h-11 px-3 rounded-md border border-amber-400 bg-white/70 text-amber-900 disabled:opacity-60 dark:bg-amber-900/30 dark:border-amber-600 dark:text-amber-100"
                            >
                                {isRecoveringStorage ? t('app.refreshingButton') : t('app.refreshButton')}
                            </button>
                        </div>
                    </div>
                )}
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
                        path="/auth/callback"
                        element={<AuthCallbackPage />}
                    />
                    <Route
                        path="/"
                        element={
                            isAuthenticated ? <HomePage /> : <LandingPage />
                        }
                    />
                    <Route
                        path="/dashboard"
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
