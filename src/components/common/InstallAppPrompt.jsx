import { useEffect, useMemo, useState } from 'react';
import { X, Download, Monitor, Smartphone } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

function getPlatform() {
    const userAgent = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(userAgent);

    if (isIOS) {
        return 'ios';
    }

    if (isAndroid) {
        return 'android';
    }

    const isDesktop = !/webOS|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    return isDesktop ? 'desktop' : 'unsupported';
}

export default function InstallAppPrompt() {
    const { t } = useTranslation();
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showPrompt, setShowPrompt] = useState(false);
    const [platform, setPlatform] = useState('unsupported');
    const [isStandalone, setIsStandalone] = useState(false);

    useEffect(() => {
        const standalone = window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true;
        setIsStandalone(standalone);

        const detectedPlatform = getPlatform();
        setPlatform(detectedPlatform);

        const dismissed = localStorage.getItem('pwa-install-dismissed');
        const dismissedTime = dismissed ? parseInt(dismissed, 10) : 0;
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        const shouldShow = !dismissed || (Date.now() - dismissedTime > oneWeek);

        const handleBeforeInstallPrompt = (event) => {
            event.preventDefault();
            setDeferredPrompt(event);

            if (shouldShow && !standalone) {
                setShowPrompt(true);
            }
        };

        const handleAppInstalled = () => {
            setShowPrompt(false);
            setDeferredPrompt(null);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        if ((detectedPlatform === 'ios' || detectedPlatform === 'android') && shouldShow && !standalone) {
            const timer = window.setTimeout(() => {
                setShowPrompt(true);
            }, detectedPlatform === 'ios' ? 2000 : 3000);

            return () => {
                window.clearTimeout(timer);
                window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
                window.removeEventListener('appinstalled', handleAppInstalled);
            };
        }

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    const promptContent = useMemo(() => {
        if (platform === 'ios') {
            return {
                icon: Smartphone,
                title: t('app.installPrompt.iosTitle'),
                body: t('app.installPrompt.iosBody'),
                ctaLabel: null,
            };
        }

        if (platform === 'android') {
            const hasInstallPrompt = !!deferredPrompt;
            return {
                icon: Smartphone,
                title: hasInstallPrompt ? t('app.installPrompt.androidTitleReady') : t('app.installPrompt.androidTitleManual'),
                body: hasInstallPrompt
                    ? t('app.installPrompt.androidBodyReady')
                    : t('app.installPrompt.androidBodyManual'),
                ctaLabel: hasInstallPrompt ? t('app.installPrompt.androidCta') : null,
            };
        }

        if (platform === 'desktop') {
            return {
                icon: Monitor,
                title: t('app.installPrompt.desktopTitle'),
                body: t('app.installPrompt.desktopBody'),
                ctaLabel: t('app.installPrompt.desktopCta'),
            };
        }

        return null;
    }, [platform, deferredPrompt, t]);

    const canShowPrompt = !isStandalone && promptContent && (
        platform === 'ios'
            ? showPrompt
            : platform === 'android'
                ? showPrompt
                : showPrompt && !!deferredPrompt
    );

    const handleInstall = async () => {
        if (!deferredPrompt) {
            return;
        }

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            setShowPrompt(false);
        }
        setDeferredPrompt(null);
    };

    const handleDismiss = () => {
        setShowPrompt(false);
        localStorage.setItem('pwa-install-dismissed', Date.now().toString());
    };

    if (!canShowPrompt) {
        return null;
    }

    const PromptIcon = promptContent.icon;

    return (
        <div className="fixed bottom-20 left-4 right-4 z-50 animate-slide-up">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-12 h-12 bg-primary-100 dark:bg-primary-900 rounded-xl flex items-center justify-center">
                        <PromptIcon className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                    </div>

                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-base">
                            {promptContent.title}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {promptContent.body}
                        </p>

                        {platform === 'ios' ? (
                            <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                                <p className="font-medium text-gray-900 dark:text-white mb-2">{t('app.installPrompt.iosStepsTitle')}</p>
                                <ol className="list-decimal list-inside space-y-1">
                                    <li>{t('app.installPrompt.iosStepOne')} <span className="inline-block w-5 h-5 align-middle">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
                                        </svg>
                                    </span></li>
                                    <li>{t('app.installPrompt.iosStepTwo')}</li>
                                </ol>
                            </div>
                        ) : platform === 'android' && !deferredPrompt ? (
                            <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                                <p className="font-medium text-gray-900 dark:text-white mb-2">{t('app.installPrompt.androidStepsTitle')}</p>
                                <ol className="list-decimal list-inside space-y-1">
                                    <li>{t('app.installPrompt.androidStepOne')}</li>
                                    <li>{t('app.installPrompt.androidStepTwo')}</li>
                                </ol>
                            </div>
                        ) : (
                            <button
                                onClick={handleInstall}
                                className="mt-3 flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium text-sm transition-colors min-h-[44px]"
                            >
                                <Download size={18} />
                                {promptContent.ctaLabel}
                            </button>
                        )}
                    </div>

                    <button
                        onClick={handleDismiss}
                        className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        aria-label={t('app.installPrompt.dismiss')}
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
}
