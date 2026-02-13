import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';

export default function AuthCallbackPage() {
    const navigate = useNavigate();
    const setCurrentUser = useAppStore((state) => state.setCurrentUser);
    const showToast = useAppStore((state) => state.showToast);
    const [status, setStatus] = useState('Processing sign in...');

    useEffect(() => {
        const handleCallback = async () => {
            try {
                const { supabase } = await import('../services/supabaseService');

                if (!supabase) {
                    throw new Error('Supabase not configured');
                }

                // Get URL parameters
                const url = new URL(window.location.href);
                const code = url.searchParams.get('code');
                const errorParam = url.searchParams.get('error');
                const errorDescription = url.searchParams.get('error_description');

                // Check for OAuth error
                if (errorParam) {
                    console.error('OAuth error:', errorParam, errorDescription);
                    setStatus('Sign in failed');
                    showToast(errorDescription || errorParam, 'error');
                    setTimeout(() => navigate('/login'), 2000);
                    return;
                }

                // If we have a code, exchange it for a session
                if (code) {
                    console.log('Exchanging code for session...');
                    setStatus('Completing sign in...');

                    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

                    if (error) {
                        console.error('Code exchange error:', error);
                        setStatus('Sign in failed');
                        showToast(error.message || 'Failed to sign in', 'error');
                        setTimeout(() => navigate('/login'), 2000);
                        return;
                    }

                    if (data?.session?.user) {
                        console.log('Sign in successful:', data.session.user.email);
                        setCurrentUser({
                            userId: data.session.user.id,
                            email: data.session.user.email
                        });
                        showToast('Successfully signed in with Google', 'success');

                        // Clean up URL and navigate
                        window.history.replaceState({}, '', '/');
                        navigate('/');
                        return;
                    }
                }

                // No code - check for existing session
                const { data: { session } } = await supabase.auth.getSession();

                if (session?.user) {
                    console.log('Existing session found:', session.user.email);
                    setCurrentUser({
                        userId: session.user.id,
                        email: session.user.email
                    });
                    navigate('/');
                    return;
                }

                // No session found
                console.log('No session found');
                setStatus('No session found. Redirecting...');
                setTimeout(() => navigate('/login'), 2000);

            } catch (err) {
                console.error('Auth callback error:', err);
                setStatus('An error occurred');
                showToast('Failed to complete sign in', 'error');
                setTimeout(() => navigate('/login'), 2000);
            }
        };

        handleCallback();
    }, [navigate, setCurrentUser, showToast]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400">{status}</p>
            </div>
        </div>
    );
}
