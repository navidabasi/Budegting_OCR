import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './store/appStore';
import { authService } from './services/authService';
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

