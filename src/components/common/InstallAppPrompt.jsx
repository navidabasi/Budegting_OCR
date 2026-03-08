import { useState, useEffect } from 'react';
import { X, Download, Smartphone, Share2 } from 'lucide-react';

export default function InstallAppPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showPrompt, setShowPrompt] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);
    const [showIOSSteps, setShowIOSSteps] = useState(false);

    useEffect(() => {
        // Check if already installed (standalone mode)
        const standalone = window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true;
        setIsStandalone(standalone);

        // Check if iOS
        const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        setIsIOS(iOS);

        // Check if user dismissed the prompt before
        const dismissed = localStorage.getItem('pwa-install-dismissed');
        const dismissedTime = dismissed ? parseInt(dismissed, 10) : 0;
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        const shouldShow = !dismissed || (Date.now() - dismissedTime > oneWeek);

        // Check if mobile/tablet
        const isMobileOrTablet = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            (window.innerWidth <= 1024 && 'ontouchstart' in window);

        // Listen for the beforeinstallprompt event (Android/Chrome)
        const handleBeforeInstallPrompt = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
            if (shouldShow && isMobileOrTablet && !standalone) {
                setShowPrompt(true);
            }
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        // For iOS, show custom instructions if criteria met
        if (iOS && shouldShow && isMobileOrTablet && !standalone) {
            // Small delay to not interrupt initial load
            setTimeout(() => setShowPrompt(true), 2000);
        }

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    const handleInstall = async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                setShowPrompt(false);
            }
            setDeferredPrompt(null);
        }
    };

    const handleDismiss = () => {
        setShowPrompt(false);
        localStorage.setItem('pwa-install-dismissed', Date.now().toString());
    };

    const handleIOSInstall = async () => {
        // iOS does not support programmatic Add-to-Home-Screen.
        // Best effort: open native share sheet if available, then show fallback steps.
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Where my money went?',
                    text: 'Install this app to your home screen for quick access.',
                    url: window.location.href
                });
                return;
            } catch (error) {
                // User cancelled or share unavailable for current context.
            }
        }

        setShowIOSSteps(true);
    };

    if (!showPrompt || isStandalone) {
        return null;
    }

    return (
        <div className="fixed bottom-20 left-4 right-4 z-50 animate-slide-up">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-12 h-12 bg-primary-100 dark:bg-primary-900 rounded-xl flex items-center justify-center">
                        <Smartphone className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                    </div>

                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-base">
                            Install App
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            Add "Where my money went?" to your home screen for quick access and offline use.
                        </p>

                        {isIOS ? (
                            <>
                                <button
                                    onClick={handleIOSInstall}
                                    className="mt-3 flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium text-sm transition-colors min-h-[44px]"
                                >
                                    <Share2 size={18} />
                                    Install on iPhone
                                </button>

                                {showIOSSteps && (
                                    <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                                        <p className="font-medium text-gray-900 dark:text-white mb-2">To install:</p>
                                        <ol className="list-decimal list-inside space-y-1">
                                            <li>Tap the Share button <span className="inline-block w-5 h-5 align-middle">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
                                                </svg>
                                            </span></li>
                                            <li>Scroll down and tap "Add to Home Screen"</li>
                                        </ol>
                                    </div>
                                )}
                            </>
                        ) : (
                            <button
                                onClick={handleInstall}
                                className="mt-3 flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium text-sm transition-colors min-h-[44px]"
                            >
                                <Download size={18} />
                                Install Now
                            </button>
                        )}
                    </div>

                    <button
                        onClick={handleDismiss}
                        className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        aria-label="Dismiss"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
}
