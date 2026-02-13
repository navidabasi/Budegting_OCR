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
                // Import supabase dynamically
                const { supabase } = await import('../services/supabaseService');

                if (!supabase) {
                    throw new Error('Supabase not configured');
                }

                // Get the session from the URL hash/params
                const { data: { session }, error } = await supabase.auth.getSession();

                if (error) {
                    console.error('Auth callback error:', error);
                    setStatus('Sign in failed');
                    showToast(error.message || 'Failed to sign in', 'error');
                    setTimeout(() => navigate('/login'), 2000);
                    return;
                }

                if (session?.user) {
                    // Successfully signed in
                    setCurrentUser({
                        userId: session.user.id,
                        email: session.user.email
                    });
                    showToast('Successfully signed in with Google', 'success');
                    navigate('/');
                } else {
                    // No session found, redirect to login
                    setStatus('No session found');
                    setTimeout(() => navigate('/login'), 1000);
                }
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
