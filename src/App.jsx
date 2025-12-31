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
    const syncIntervalRef = useRef(null);
    const lastSyncRef = useRef(null);

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

    // Check for existing Supabase session on mount
    useEffect(() => {
        const checkSession = async () => {
            try {
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

        // Set up periodic sync (every 30 seconds)
        syncIntervalRef.current = setInterval(() => {
            syncFromCloud(currentUser.userId, true);
        }, 30000); // 30 seconds

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

    return (
        <BrowserRouter>
            <div className="min-h-screen bg-gray-50">
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

