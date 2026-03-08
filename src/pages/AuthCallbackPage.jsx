import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';

export default function AuthCallbackPage() {
    const navigate = useNavigate();
    const setCurrentUser = useAppStore((state) => state.setCurrentUser);
    const showToast = useAppStore((state) => state.showToast);
    const [status, setStatus] = useState('Completing Google sign in...');

    useEffect(() => {
        let isMounted = true;

        const redirectToLogin = (message) => {
            if (!isMounted) return;
            if (message) {
                showToast(message, 'error');
            }
            setStatus('Sign in failed. Redirecting to login...');
            setTimeout(() => navigate('/login', { replace: true }), 1800);
        };

        const handleCallback = async () => {
            try {
                const { supabase } = await import('../services/supabaseService');

                if (!supabase) {
                    redirectToLogin('Authentication is not configured.');
                    return;
                }

                const url = new URL(window.location.href);
                const errorParam = url.searchParams.get('error');

                if (errorParam) {
                    redirectToLogin('Google sign in was cancelled or failed. Please try again.');
                    return;
                }

                const { data: { session }, error: sessionError } = await supabase.auth.getSession();
                if (sessionError) {
                    console.error('Session retrieval failed during auth callback:', sessionError);
                }

                let activeSession = session;

                if (!activeSession?.user) {
                    const code = url.searchParams.get('code');
                    if (code) {
                        setStatus('Finalizing sign in...');
                        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
                        if (error) {
                            console.error('OAuth code exchange failed:', error);
                            redirectToLogin('Unable to complete Google sign in. Please try again.');
                            return;
                        }
                        activeSession = data?.session;
                    }
                }

                if (!activeSession?.user) {
                    redirectToLogin('No active session found. Please sign in again.');
                    return;
                }

                if (!isMounted) return;
                setCurrentUser({
                    userId: activeSession.user.id,
                    email: activeSession.user.email
                });
                showToast('Successfully signed in with Google', 'success');
                navigate('/', { replace: true });
            } catch (err) {
                console.error('Auth callback error:', err);
                redirectToLogin('Unable to complete sign in right now.');
            }
        };

        handleCallback();

        return () => {
            isMounted = false;
        };
    }, [navigate, setCurrentUser, showToast]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="text-center max-w-lg mx-auto p-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400">{status}</p>
            </div>
        </div>
    );
}
