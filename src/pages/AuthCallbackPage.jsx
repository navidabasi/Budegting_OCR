import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';

export default function AuthCallbackPage() {
    const navigate = useNavigate();
    const setCurrentUser = useAppStore((state) => state.setCurrentUser);
    const showToast = useAppStore((state) => state.showToast);
    const [status, setStatus] = useState('Processing sign in...');
    const [debugInfo, setDebugInfo] = useState('');

    useEffect(() => {
        const handleCallback = async () => {
            // Debug: Show current URL
            const currentUrl = window.location.href;
            setDebugInfo(`URL: ${currentUrl}`);
            console.log('=== AUTH CALLBACK START ===');
            console.log('Full URL:', currentUrl);

            try {
                const { supabase } = await import('../services/supabaseService');
                console.log('Supabase loaded:', !!supabase);

                if (!supabase) {
                    setStatus('Supabase not configured');
                    setDebugInfo(prev => prev + '\nSupabase: NOT CONFIGURED');
                    setTimeout(() => navigate('/login'), 2000);
                    return;
                }

                // Get URL parameters
                const url = new URL(window.location.href);
                const code = url.searchParams.get('code');
                const errorParam = url.searchParams.get('error');
                const errorDescription = url.searchParams.get('error_description');

                console.log('URL params - code:', code ? 'YES' : 'NO', 'error:', errorParam);
                setDebugInfo(prev => prev + `\nCode: ${code ? 'Present' : 'Missing'}`);

                // Check for OAuth error
                if (errorParam) {
                    console.error('OAuth error:', errorParam, errorDescription);
                    setStatus(`Error: ${errorDescription || errorParam}`);
                    setDebugInfo(prev => prev + `\nError: ${errorParam}`);
                    setTimeout(() => navigate('/login'), 3000);
                    return;
                }

                // If we have a code, exchange it for a session
                if (code) {
                    console.log('Exchanging code for session...');
                    setStatus('Completing sign in...');
                    setDebugInfo(prev => prev + '\nExchanging code...');

                    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

                    console.log('Exchange result - error:', error, 'session:', !!data?.session);

                    if (error) {
                        console.error('Code exchange error:', error);
                        setStatus('Sign in failed');
                        setDebugInfo(prev => prev + `\nExchange error: ${error.message}`);
                        showToast(error.message || 'Failed to sign in', 'error');
                        setTimeout(() => navigate('/login'), 3000);
                        return;
                    }

                    if (data?.session?.user) {
                        console.log('Sign in successful:', data.session.user.email);
                        setCurrentUser({
                            userId: data.session.user.id,
                            email: data.session.user.email
                        });
                        showToast('Successfully signed in with Google', 'success');
                        window.history.replaceState({}, '', '/');
                        navigate('/');
                        return;
                    }
                }

                // No code - check for existing session
                console.log('No code, checking existing session...');
                setDebugInfo(prev => prev + '\nNo code, checking session...');

                const { data: { session }, error: sessionError } = await supabase.auth.getSession();
                console.log('Session check - error:', sessionError, 'session:', !!session);

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
                setDebugInfo(prev => prev + '\nNo session found');
                setTimeout(() => navigate('/login'), 3000);

            } catch (err) {
                console.error('Auth callback error:', err);
                setStatus('An error occurred');
                setDebugInfo(prev => prev + `\nError: ${err.message}`);
                setTimeout(() => navigate('/login'), 3000);
            }
        };

        handleCallback();
    }, [navigate, setCurrentUser, showToast]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="text-center max-w-lg mx-auto p-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400 mb-4">{status}</p>
                <pre className="text-left text-xs bg-gray-200 dark:bg-gray-800 p-3 rounded overflow-auto whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                    {debugInfo || 'Loading...'}
                </pre>
            </div>
        </div>
    );
}
