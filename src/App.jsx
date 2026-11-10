import { useEffect, useMemo, useRef, useState } from 'react';
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
import { checkStorageHealth, useSaveSettings, useSettings, useSyncStatus, useTransactions } from './data/hooks';
import { startSync, syncNow } from './data/sync';
import { notifyDataChanged } from './data/queryClient';
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
import Modal from './components/common/Modal';
import Button from './components/common/Button';
import { detectDeviceLanguage, normalizeLanguageCode } from './languages';
import { useTranslation } from './languages/useTranslation';
import {
    collectPaymentNotificationEvents,
    DEFAULT_DAILY_REMINDER_TIME,
    getLocalDateKey,
    hasNotificationBeenSent,
    markNotificationSent,
    normalizeNotificationPreferences,
    requestNotificationPermission,
    sendBrowserNotification,
    shouldShowNotificationSetupPrompt,
    shouldTriggerDailyExpenseReminder,
} from './services/notificationService';

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
    const setLanguageCode = useAppStore((state) => state.setLanguageCode);
    const storageWarningShownRef = useRef(false);
    const languagePersistedRef = useRef(false);
    const { settings, isSuccess: settingsLoaded } = useSettings();
    const saveSettings = useSaveSettings();
    const syncStatus = useSyncStatus();
    const { transactions: receipts } = useTransactions();
    const showToastRef = useRef(showToast);
    const [isRecoveringStorage, setIsRecoveringStorage] = useState(false);
    const [showNotificationSetupPrompt, setShowNotificationSetupPrompt] = useState(false);
    const [notificationPromptLoading, setNotificationPromptLoading] = useState(false);

    const handleRefreshStorage = async () => {
        if (!currentUser?.userId || isRecoveringStorage) return;

        if (!navigator.onLine) {
            showToastRef.current(t('app.offlineWarning'), 'warning');
            return;
        }

        setIsRecoveringStorage(true);
        try {
            const health = await checkStorageHealth(true);
            setStorageHealth(health);

            if (health.hasLocalCache) {
                storageWarningShownRef.current = false;
                showToastRef.current(t('app.cacheRestored'), 'success');
                notifyDataChanged();
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

    const saveNotificationPreferences = async (updater) => {
        if (!currentUser?.userId) return null;

        const currentPreferences = normalizeNotificationPreferences(settings?.notificationPreferences || null);
        const updatedPreferences = normalizeNotificationPreferences(
            typeof updater === 'function' ? updater(currentPreferences) : updater
        );

        await saveSettings({ notificationPreferences: updatedPreferences });
        return updatedPreferences;
    };

    const handleNotificationPromptMaybeLater = async () => {
        if (!currentUser?.userId || notificationPromptLoading) {
            setShowNotificationSetupPrompt(false);
            return;
        }

        setNotificationPromptLoading(true);
        try {
            const nowIso = new Date().toISOString();
            await saveNotificationPreferences((preferences) => ({
                ...preferences,
                lastSetupPromptAt: nowIso,
            }));
        } catch (error) {
            console.error('[App] Failed to postpone notification setup prompt:', error);
        } finally {
            setNotificationPromptLoading(false);
            setShowNotificationSetupPrompt(false);
        }
    };

    const handleNotificationPromptEnableNow = async () => {
        if (!currentUser?.userId || notificationPromptLoading) return;

        setNotificationPromptLoading(true);
        try {
            const permission = await requestNotificationPermission();
            const nowIso = new Date().toISOString();

            await saveNotificationPreferences((preferences) => ({
                ...preferences,
                enabled: permission === 'granted',
                paymentDueAlertsEnabled: true,
                dailyExpenseReminderEnabled: true,
                dailyExpenseReminderTime: preferences.dailyExpenseReminderTime || DEFAULT_DAILY_REMINDER_TIME,
                configuredAt: nowIso,
                lastSetupPromptAt: nowIso,
            }));

            setShowNotificationSetupPrompt(false);
            if (permission === 'granted') {
                showToastRef.current(t('app.notifications.setupPromptEnabledSuccess'), 'success');
            } else if (permission === 'denied') {
                showToastRef.current(t('app.notifications.setupPromptPermissionDenied'), 'warning');
            } else if (permission === 'unsupported') {
                showToastRef.current(t('app.notifications.setupPromptUnsupported'), 'warning');
            } else {
                showToastRef.current(t('app.notifications.setupPromptPermissionNotGranted'), 'warning');
            }
        } catch (error) {
            console.error('[App] Failed to enable notifications from setup prompt:', error);
            showToastRef.current(t('app.notifications.saveFailed'), 'error');
        } finally {
            setNotificationPromptLoading(false);
        }
    };

    // Keep showToast ref updated
    useEffect(() => {
        showToastRef.current = showToast;
    }, [showToast]);

    // Open the local IndexedDB mirror when the user authenticates and report its health
    useEffect(() => {
        if (!currentUser?.userId) {
            storageWarningShownRef.current = false;
            setStorageHealth({
                hasLocalCache: true,
                initFailed: false,
                fallbackMode: false,
                lastError: null,
                lastAttemptAt: null
            });
            return;
        }

        let cancelled = false;
        checkStorageHealth().then((health) => {
            if (cancelled) return;
            setStorageHealth(health);
            if (!health.hasLocalCache && !storageWarningShownRef.current) {
                showToastRef.current(t('app.offlineModeLimited'), 'warning');
                storageWarningShownRef.current = true;
            } else if (health.hasLocalCache) {
                storageWarningShownRef.current = false;
            }
        });

        return () => {
            cancelled = true;
        };
    }, [currentUser?.userId, setStorageHealth]);

    // Sync lifecycle: startup, online/focus/visibility, and periodic sync every 5 minutes
    useEffect(() => {
        if (!currentUser?.userId) return;
        return startSync(currentUser.userId);
    }, [currentUser?.userId]);

    // Retry opening the local cache when the app comes back online / into focus while it was unavailable
    useEffect(() => {
        if (!currentUser?.userId || !storageHealth?.fallbackMode) return;

        const retry = () => {
            checkStorageHealth(true).then((health) => {
                setStorageHealth(health);
                if (health.hasLocalCache) {
                    storageWarningShownRef.current = false;
                    notifyDataChanged();
                }
            });
        };
        window.addEventListener('online', retry);
        window.addEventListener('focus', retry);
        return () => {
            window.removeEventListener('online', retry);
            window.removeEventListener('focus', retry);
        };
    }, [currentUser?.userId, storageHealth?.fallbackMode, setStorageHealth]);

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

                            showToastRef.current(t('app.signedInSuccess'), 'success');

                            // Pull data right after sign-in (the sync lifecycle effect also starts on the user change)
                            syncNow(session.user.id, { reason: 'signin' }).catch((error) => {
                                console.error('[App] Post-signin sync failed:', error);
                            });
                        } else if (event === 'SIGNED_OUT') {
                            // Only clear auth state if actually online — offline token
                            // validation failures should not log the user out
                            if (navigator.onLine) {
                                setCurrentUser(null);
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
    const accountLanguage = normalizeLanguageCode(settings?.languageCode || '', '');
    useEffect(() => {
        const deviceLanguage = detectDeviceLanguage();
        const localLanguage = normalizeLanguageCode(useAppStore.getState().languageCode || '', '');

        if (!currentUser?.userId) {
            languagePersistedRef.current = false;
            setLanguageCode(localLanguage || deviceLanguage);
            return;
        }

        if (!settingsLoaded) return;

        const resolvedLanguage = accountLanguage || localLanguage || deviceLanguage;
        setLanguageCode(resolvedLanguage);

        // Persist only when there is no account value yet, and only after the first pull so a
        // language chosen on another device is never overwritten by the detected one.
        if (!accountLanguage && syncStatus.hasPulled && !languagePersistedRef.current) {
            languagePersistedRef.current = true;
            saveSettings({ languageCode: resolvedLanguage }).catch((err) => {
                console.warn('[App] Failed to persist detected language:', err);
            });
        }
    }, [currentUser?.userId, settingsLoaded, accountLanguage, syncStatus.hasPulled, setLanguageCode]);

    // Notification setup prompt (first login and every 48h until configured)
    const notificationPreferences = useMemo(
        () => normalizeNotificationPreferences(settings?.notificationPreferences || null),
        [settings?.notificationPreferences]
    );
    useEffect(() => {
        if (!currentUser?.userId || !settingsLoaded) {
            setShowNotificationSetupPrompt(false);
            return;
        }
        // Wait for the first pull so preferences configured on another device are known
        if (!syncStatus.attempted && navigator.onLine) return;

        setShowNotificationSetupPrompt(shouldShowNotificationSetupPrompt(notificationPreferences));
    }, [currentUser?.userId, settingsLoaded, syncStatus.attempted, notificationPreferences]);

    // Notification runtime checks (while app/PWA is open)
    const notificationDataRef = useRef({ receipts: [], preferences: notificationPreferences });
    notificationDataRef.current = { receipts, preferences: notificationPreferences };
    const runChecksRef = useRef(null);
    useEffect(() => {
        if (!currentUser?.userId) return;

        let disposed = false;
        let running = false;

        const runNotificationChecks = async () => {
            if (disposed || running || !currentUser?.userId) {
                return;
            }

            running = true;
            try {
                const preferences = notificationDataRef.current.preferences;

                if (!preferences.enabled) {
                    return;
                }

                const now = new Date();
                const dayKey = getLocalDateKey(now);
                const receipts = notificationDataRef.current.receipts;

                if (preferences.paymentDueAlertsEnabled) {
                    const paymentEvents = collectPaymentNotificationEvents(receipts, now);
                    for (const event of paymentEvents) {
                        if (hasNotificationBeenSent(currentUser.userId, event.notificationKey, dayKey)) {
                            continue;
                        }

                        const merchantName = event.merchant || t('dashboard.topMerchants.unknown');
                        const title = event.kind === 'overdue'
                            ? t('app.notifications.paymentOverdueTitle')
                            : t('app.notifications.paymentDueTitle');
                        let body = '';

                        if (event.kind === 'overdue') {
                            body = t('app.notifications.paymentOverdueBody', {
                                merchant: merchantName,
                                days: event.overdueDays,
                                suffix: event.overdueDays === 1 ? '' : 's',
                            });
                        } else if (event.daysUntilDue === 0) {
                            body = t('app.notifications.paymentDueTodayBody', {
                                merchant: merchantName,
                            });
                        } else {
                            body = t('app.notifications.paymentDueInDaysBody', {
                                merchant: merchantName,
                                days: event.daysUntilDue,
                                suffix: event.daysUntilDue === 1 ? '' : 's',
                            });
                        }

                        const shown = sendBrowserNotification({
                            title,
                            body,
                            tag: event.notificationKey,
                        });

                        if (!shown) {
                            showToastRef.current(body, 'info');
                        }

                        markNotificationSent(currentUser.userId, event.notificationKey, dayKey);
                    }
                }

                if (shouldTriggerDailyExpenseReminder(preferences, now)) {
                    const dailyReminderKey = 'daily-expense-reminder';
                    if (!hasNotificationBeenSent(currentUser.userId, dailyReminderKey, dayKey)) {
                        const title = t('app.notifications.dailyReminderTitle');
                        const body = t('app.notifications.dailyReminderBody');
                        const shown = sendBrowserNotification({
                            title,
                            body,
                            tag: dailyReminderKey,
                        });

                        if (!shown) {
                            showToastRef.current(body, 'info');
                        }

                        markNotificationSent(currentUser.userId, dailyReminderKey, dayKey);
                    }
                }
            } catch (error) {
                console.error('[App] Notification runtime check failed:', error);
            } finally {
                running = false;
            }
        };

        const handleFocus = () => {
            runNotificationChecks();
        };
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                runNotificationChecks();
            }
        };
        runNotificationChecks();
        const intervalId = setInterval(runNotificationChecks, 5 * 60 * 1000);
        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibility);
        runChecksRef.current = runNotificationChecks;

        return () => {
            disposed = true;
            clearInterval(intervalId);
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibility);
            runChecksRef.current = null;
        };
    }, [currentUser?.userId, t]);

    // Re-run the checks whenever receipts or notification preferences change
    useEffect(() => {
        runChecksRef.current?.();
    }, [receipts, notificationPreferences]);

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
                        <Modal
                            isOpen={showNotificationSetupPrompt}
                            onClose={handleNotificationPromptMaybeLater}
                            title={t('app.notifications.setupPromptTitle')}
                            size="md"
                        >
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                                {t('app.notifications.setupPromptMessage')}
                            </p>
                            <div className="flex gap-2 mt-6">
                                <Button
                                    variant="secondary"
                                    onClick={handleNotificationPromptMaybeLater}
                                    disabled={notificationPromptLoading}
                                    className="flex-1"
                                >
                                    {t('app.notifications.setupPromptMaybeLater')}
                                </Button>
                                <Button
                                    variant="primary"
                                    onClick={handleNotificationPromptEnableNow}
                                    disabled={notificationPromptLoading}
                                    className="flex-1"
                                >
                                    {notificationPromptLoading
                                        ? t('common.states.saving')
                                        : t('app.notifications.setupPromptEnableNow')}
                                </Button>
                            </div>
                        </Modal>
                    </>
                )}

                <Toast />
            </div>
        </BrowserRouter>
    );
}

export default App;
