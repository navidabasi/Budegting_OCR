import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useAppStore } from '../store/appStore';
import {
    useCreateCategory,
    useDeleteCategory,
    useAccounts,
    useDemoData,
    useTransactions,
    useSaveSettings,
    useSettings,
    useSyncActions,
    useUpdateCategory,
    useUserCategories,
} from '../data/hooks';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import ConfirmationModal from '../components/common/ConfirmationModal';
import SettingsCard from '../components/common/SettingsCard';
import AccountsManager from '../components/settings/AccountsManager';
import ImportSheet from '../components/import/ImportSheet';
import DataSafety from '../components/settings/DataSafety';
import PayCycleSettings from '../components/settings/PayCycleSettings';
import { buildCsv, downloadCsv } from '../utils/exportCsv';
import { recalculateBaseAmounts } from '../data/repo';
import { notifyDataChanged } from '../data/queryClient';
import { getScanPrefs, setScanPrefs } from '../utils/scanPrefs';
import ToggleRow from '../components/common/ToggleRow';
import AiBoundarySettings from '../components/settings/AiBoundarySettings';
import { LogOut, Upload, Database, Key, Download, Info, Landmark, DollarSign, Cloud, Tag, Plus, Trash2, Edit2, Moon, Sun, Globe, Bell, ChevronDown, RefreshCw } from 'lucide-react';
import { detectDeviceLanguage, LANGUAGE_OPTIONS, normalizeLanguageCode } from '../languages';
import { useTranslation } from '../languages/useTranslation';
import {
    DEFAULT_DAILY_REMINDER_TIME,
    getNotificationPermissionStatus,
    normalizeNotificationPreferences,
    requestNotificationPermission,
} from '../services/notificationService';

export default function SettingsPage() {
    const { t } = useTranslation();
    const currentUser = useAppStore((state) => state.currentUser);
    const logout = useAppStore((state) => state.logout);
    const showToast = useAppStore((state) => state.showToast);
    const setLanguageCode = useAppStore((state) => state.setLanguageCode);
    const darkMode = useAppStore((state) => state.darkMode);
    const darkModeManual = useAppStore((state) => state.darkModeManual);
    const toggleDarkMode = useAppStore((state) => state.toggleDarkMode);
    const resetToSystemDarkMode = useAppStore((state) => state.resetToSystemDarkMode);
    const getSystemDarkMode = useAppStore((state) => state.getSystemDarkMode);
    const { register, handleSubmit, setValue, formState: { errors } } = useForm();
    const { control: controlCurrency, handleSubmit: handleSubmitCurrency, reset: resetCurrency } = useForm({
        defaultValues: {
            defaultCurrency: 'EUR'
        }
    });
    const { transactions: allTransactions } = useTransactions();
    const { accounts: allAccounts } = useAccounts();
    const [scanPrefs, setScanPrefsState] = useState(getScanPrefs);
    const handleExportCsv = () => {
        downloadCsv(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(allTransactions, allAccounts));
        showToast(t('prefs.data.exported'), 'success');
    };
    const [apiKey, setApiKey] = useState('');
    const [defaultCurrency, setDefaultCurrency] = useState('EUR');
    const [loading, setLoading] = useState(false);
    const [loadingCurrency, setLoadingCurrency] = useState(false);
    const [loadingLanguage, setLoadingLanguage] = useState(false);
    const [loadingNotifications, setLoadingNotifications] = useState(false);
    const [loadingDemo, setLoadingDemo] = useState(false);
    const [clearingDemo, setClearingDemo] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncStatus, setSyncStatus] = useState(null);
    const [showClearResyncConfirm, setShowClearResyncConfirm] = useState(false);
    const [showLoadDemoConfirm, setShowLoadDemoConfirm] = useState(false);
    const [showClearDemoConfirm, setShowClearDemoConfirm] = useState(false);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [showDeleteCategoryConfirm, setShowDeleteCategoryConfirm] = useState(false);
    const [categoryToDelete, setCategoryToDelete] = useState(null);
    const [editingCategory, setEditingCategory] = useState(null);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryColor, setNewCategoryColor] = useState('#00573f');
    const [selectedLanguage, setSelectedLanguage] = useState(detectDeviceLanguage());
    const [notificationPermission, setNotificationPermission] = useState(getNotificationPermissionStatus());
    const [notificationPreferences, setNotificationPreferences] = useState(() =>
        normalizeNotificationPreferences(null)
    );
    const { settings, isSuccess: settingsLoaded, defaultCurrency: storedCurrency } = useSettings();
    const saveSettings = useSaveSettings();
    const { categories: customCategories } = useUserCategories();
    const createCategory = useCreateCategory();
    const updateCategory = useUpdateCategory();
    const deleteCategory = useDeleteCategory();
    const [importOpen, setImportOpen] = useState(false);
    const { demoCount: demoReceiptCount, seedDemoData, clearDemoData } = useDemoData();
    const { syncNow, clearAndResync } = useSyncActions();

    // Hydrate the forms from the stored settings. Each field re-hydrates only when its stored value
    // changes (after the first sync or a save), so unsaved edits in other sections are not reset.
    const storedApiKey = settings?.ocrApiKey || settings?.veryfiApiKey || '';
    useEffect(() => {
        if (!currentUser || !settingsLoaded) return;
        if (storedApiKey) {
            setApiKey(storedApiKey);
            setValue('ocrApiKey', storedApiKey);
        }
    }, [currentUser, settingsLoaded, storedApiKey, setValue]);

    useEffect(() => {
        if (!currentUser || !settingsLoaded) return;
        setDefaultCurrency(storedCurrency);
        resetCurrency({ defaultCurrency: storedCurrency });
    }, [currentUser, settingsLoaded, storedCurrency, resetCurrency]);

    const storedLanguage = settings?.languageCode || '';
    useEffect(() => {
        if (!currentUser || !settingsLoaded) return;
        const language = normalizeLanguageCode(storedLanguage, '');
        setSelectedLanguage(language || detectDeviceLanguage());
    }, [currentUser, settingsLoaded, storedLanguage]);

    const storedNotificationPreferences = settings?.notificationPreferences || null;
    useEffect(() => {
        if (!currentUser || !settingsLoaded) return;
        setNotificationPreferences(normalizeNotificationPreferences(storedNotificationPreferences));
        setNotificationPermission(getNotificationPermissionStatus());
    }, [currentUser, settingsLoaded, storedNotificationPreferences]);

    useEffect(() => {
        const refreshPermission = () => {
            setNotificationPermission(getNotificationPermissionStatus());
        };

        refreshPermission();
        window.addEventListener('focus', refreshPermission);
        document.addEventListener('visibilitychange', refreshPermission);
        return () => {
            window.removeEventListener('focus', refreshPermission);
            document.removeEventListener('visibilitychange', refreshPermission);
        };
    }, []);

    const onSaveApiKey = async (data) => {
        if (!currentUser) {
            showToast(t('settings.toasts.userNotLoggedIn'), 'error');
            return;
        }

        if (!currentUser.userId) {
            showToast(t('settings.toasts.invalidUserId'), 'error');
            console.error('currentUser:', currentUser);
            return;
        }

        setLoading(true);
        try {
            const apiKeyValue = data.ocrApiKey?.trim() || '';
            await saveSettings({ ocrApiKey: apiKeyValue });
            setApiKey(apiKeyValue);
            setValue('ocrApiKey', apiKeyValue);
            showToast(t('settings.ocr.saveSuccess'), 'success');
        } catch (err) {
            console.error('Error saving API key:', err);
            console.error('currentUser:', currentUser);
            showToast(t('settings.ocr.saveFailed', { message: err.message || 'Unknown error' }), 'error');
        } finally {
            setLoading(false);
        }
    };

    const onSaveCurrency = async (data) => {
        if (!currentUser) return;

        setLoadingCurrency(true);
        try {
            const currency = data.defaultCurrency || data.currency || defaultCurrency;
            await saveSettings({ defaultCurrency: currency });
            setDefaultCurrency(currency);
            resetCurrency({ defaultCurrency: currency });
            showToast(t('settings.currency.saveSuccess'), 'success');
        } catch (err) {
            console.error('Failed to save currency:', err);
            showToast(t('settings.currency.saveFailed'), 'error');
        } finally {
            setLoadingCurrency(false);
        }
    };

    const onSaveLanguage = async () => {
        if (!currentUser) {
            showToast(t('settings.toasts.userNotLoggedIn'), 'error');
            return;
        }

        setLoadingLanguage(true);
        const normalizedLanguage = normalizeLanguageCode(selectedLanguage);

        try {
            await saveSettings({ languageCode: normalizedLanguage });
            setLanguageCode(normalizedLanguage);
            showToast(t('settings.language.saveSuccess'), 'success');
        } catch (err) {
            console.error('Failed to save language:', err);
            showToast(t('settings.language.saveFailed'), 'error');
        } finally {
            setLoadingLanguage(false);
        }
    };

    const updateNotificationPreference = (updates) => {
        setNotificationPreferences((previous) =>
            normalizeNotificationPreferences({
                ...previous,
                ...updates,
            })
        );
    };

    const onRequestNotificationPermission = async () => {
        const permission = await requestNotificationPermission();
        setNotificationPermission(permission);

        if (permission === 'granted') {
            updateNotificationPreference({
                enabled: true,
                paymentDueAlertsEnabled: true,
                dailyExpenseReminderEnabled: true,
                dailyExpenseReminderTime:
                    notificationPreferences.dailyExpenseReminderTime || DEFAULT_DAILY_REMINDER_TIME,
            });
            showToast(t('settings.notifications.permissionGrantedToast'), 'success');
            return;
        }

        if (permission === 'denied') {
            showToast(t('settings.notifications.permissionDeniedToast'), 'warning');
            return;
        }

        if (permission === 'unsupported') {
            showToast(t('settings.notifications.permissionUnsupportedToast'), 'warning');
            return;
        }

        showToast(t('settings.notifications.permissionDefaultToast'), 'info');
    };

    const onSaveNotifications = async () => {
        if (!currentUser) {
            showToast(t('settings.toasts.userNotLoggedIn'), 'error');
            return;
        }

        setLoadingNotifications(true);
        try {
            const nowIso = new Date().toISOString();
            const normalized = normalizeNotificationPreferences({
                ...notificationPreferences,
                configuredAt: notificationPreferences.configuredAt || nowIso,
                lastSetupPromptAt: nowIso,
            });

            await saveSettings({ notificationPreferences: normalized });
            setNotificationPreferences(normalized);
            showToast(t('settings.notifications.saveSuccess'), 'success');
        } catch (err) {
            console.error('Failed to save notifications settings:', err);
            showToast(t('settings.notifications.saveFailed'), 'error');
        } finally {
            setLoadingNotifications(false);
        }
    };

    const currencies = [
        { code: 'EUR', name: 'Euro' },
        { code: 'USD', name: 'US Dollar' },
        { code: 'GBP', name: 'British Pound' },
        { code: 'JPY', name: 'Japanese Yen' },
        { code: 'CAD', name: 'Canadian Dollar' },
        { code: 'AUD', name: 'Australian Dollar' },
        { code: 'CHF', name: 'Swiss Franc' },
        { code: 'CNY', name: 'Chinese Yuan' },
        { code: 'INR', name: 'Indian Rupee' },
        { code: 'MXN', name: 'Mexican Peso' },
        { code: 'BRL', name: 'Brazilian Real' },
        { code: 'ZAR', name: 'South African Rand' }
    ];

    const handleLoadDemoData = async () => {
        if (!currentUser) return;

        setLoadingDemo(true);
        setShowLoadDemoConfirm(false);
        try {
            const result = await seedDemoData();

            if (result.alreadyExists) {
                showToast(t('settings.demo.alreadyLoaded'), 'info');
            } else {
                showToast(t('settings.demo.loadedSuccess', { count: result.importedCount }), 'success');
            }

        } catch (err) {
            showToast(t('settings.demo.loadFailed'), 'error');
        } finally {
            setLoadingDemo(false);
        }
    };

    const handleClearDemoData = async () => {
        if (!currentUser) return;

        setClearingDemo(true);
        setShowClearDemoConfirm(false);
        try {
            await clearDemoData();
            showToast(t('settings.demo.clearSuccess'), 'success');
        } catch (err) {
            showToast(t('settings.demo.clearFailed'), 'error');
        } finally {
            setClearingDemo(false);
        }
    };

    const handleSync = async () => {
        console.log('[Settings] Sync clicked, currentUser:', currentUser);
        if (!currentUser) {
            showToast(t('settings.cloud.loginRequired'), 'error');
            return;
        }

        setSyncing(true);
        setSyncStatus(null);

        // Add a global timeout for the entire sync operation (30 seconds)
        const syncTimeout = setTimeout(() => {
            console.error('[Settings] Sync operation timed out after 30 seconds');
            showToast(t('settings.cloud.timedOut'), 'error');
            setSyncStatus({ type: 'error', message: t('settings.cloud.timedOut') });
            setSyncing(false);
        }, 30000);

        try {
            console.log('[Settings] Starting bidirectional sync for userId:', currentUser.userId);
            const result = await syncNow();
            clearTimeout(syncTimeout); // Clear timeout if sync completes
            console.log('[Settings] Sync result:', result);

            let message = '';
            let statusType = 'success';

            const totalChanged = (result.updated || 0) + (result.uploaded || 0);

            if (result.conflicts && result.conflicts.length > 0) {
                message = t('settings.cloud.syncedWithConflicts', {
                    updated: result.updated || 0,
                    uploaded: result.uploaded || 0,
                    conflicts: result.conflicts.length,
                });
                statusType = 'warning';
            } else if (result.errors && result.errors.length > 0) {
                const firstError = result.errors[0];
                const errorMsg = firstError.error || firstError.message || 'Unknown error';
                message = t('settings.cloud.errorsSummary', {
                    count: result.errors.length,
                    message: errorMsg,
                });
                statusType = 'error';
                console.error('[Settings] Sync errors:', result.errors);
            } else if (totalChanged > 0) {
                message = t('settings.cloud.syncedSummary', {
                    updated: result.updated || 0,
                    uploaded: result.uploaded || 0,
                });
                statusType = 'success';
            } else {
                message = t('settings.cloud.upToDate', { count: result.downloaded || 0 });
                statusType = 'success';
            }

            showToast(message, statusType);
            setSyncStatus({ type: statusType, message });

        } catch (err) {
            clearTimeout(syncTimeout); // Clear timeout on error
            console.error('[Settings] Sync error:', err);
            showToast(t('settings.cloud.syncFailed', { message: err.message || 'Unknown error' }), 'error');
            setSyncStatus({ type: 'error', message: t('settings.cloud.syncFailed', { message: err.message || 'Unknown error' }) });
        } finally {
            setSyncing(false);
        }
    };

    const [recalculating, setRecalculating] = useState(false);
    const handleRecalculateBase = async () => {
        if (!currentUser || recalculating) return;
        setRecalculating(true);
        try {
            const { updated, skipped } = await recalculateBaseAmounts(currentUser.userId);
            notifyDataChanged();
            showToast(t(skipped > 0 ? 'fx.recalcPartial' : 'fx.recalcDone', { count: updated, skipped }), skipped > 0 ? 'warning' : 'success');
        } catch (err) {
            console.error('[Settings] recalculate failed', err);
            showToast(t('fx.recalcFailed'), 'error');
        } finally {
            setRecalculating(false);
        }
    };

    const handleClearAndResync = async () => {
        console.log('[Settings] Clear & Resync clicked');
        if (!currentUser) {
            showToast(t('settings.cloud.loginRequired'), 'error');
            return;
        }
        setSyncing(true);
        setSyncStatus(null);
        setShowClearResyncConfirm(false);

        try {
            console.log('[Settings] Starting clear and resync for userId:', currentUser.userId);
            const result = await clearAndResync();
            console.log('[Settings] Clear and resync result:', result);

            if (result.errors && result.errors.length > 0) {
                console.error('[Settings] Clear and resync errors:', result.errors);
                showToast(t('settings.cloud.resyncWarning'), 'warning');
                setSyncStatus({ type: 'warning', message: t('settings.cloud.resyncWarning') });
            } else {
                showToast(t('settings.cloud.resyncSuccess'), 'success');
                setSyncStatus({ type: 'success', message: t('settings.cloud.resyncSuccess') });
            }
        } catch (err) {
            console.error('[Settings] Clear and resync error:', err);
            showToast(t('settings.cloud.resyncFailed', { message: err.message || 'Unknown error' }), 'error');
            setSyncStatus({ type: 'error', message: t('settings.cloud.resyncFailed', { message: err.message || 'Unknown error' }) });
        } finally {
            setSyncing(false);
        }
    };

    const handleLogout = async () => {
        console.log('[Settings] Logout clicked');

        try {
            console.log('[Settings] Calling logout...');
            // Call logout which will clear state and sign out from Supabase
            await logout();
            console.log('[Settings] Logout successful, clearing storage...');
            // Clear all storage
            localStorage.clear();
            sessionStorage.clear();
            // Small delay to ensure state is cleared
            await new Promise(resolve => setTimeout(resolve, 200));
            console.log('[Settings] Redirecting to login...');
            // Redirect to login
            window.location.href = '/login';
        } catch (error) {
            console.error('[Settings] Error during logout:', error);
            // Still redirect even if logout fails - clear state manually
            localStorage.clear();
            sessionStorage.clear();
            window.location.href = '/login';
        }
    };

    return (
        <div className="space-y-6">
                        <SettingsCard
                icon={LogOut}
                title={t('prefs.profile.title')}
                iconColor="text-red-600 dark:text-red-400"
            >
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    {t('settings.account.signedInAs', { email: currentUser?.email || '' })}
                </p>
                <Button variant="danger" onClick={() => setShowLogoutConfirm(true)} className="w-full">
                    {t('settings.account.logout')}
                </Button>
            </SettingsCard>

            <SettingsCard
                icon={Landmark}
                title={t('prefs.accounts.title')}
            >
                <AccountsManager />
            </SettingsCard>

            <SettingsCard
                icon={DollarSign}
                title={t('settings.currency.title')}
            >
                <form onSubmit={handleSubmitCurrency(onSaveCurrency)} className="space-y-4">
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {t('common.labels.currency')}
                        </label>
                        <Controller
                            name="defaultCurrency"
                            control={controlCurrency}
                            rules={{ required: true }}
                            render={({ field }) => (
                                <select
                                    {...field}
                                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                >
                                    {currencies.map(currency => (
                                        <option key={currency.code} value={currency.code}>
                                            {currency.code} - {currency.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                        />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('settings.currency.hint')}
                    </p>
                    <Button type="submit" variant="primary" disabled={loadingCurrency}>
                        {loadingCurrency ? t('settings.currency.saving') : t('settings.currency.save')}
                    </Button>
                </form>
            </SettingsCard>

            <SettingsCard
                icon={Globe}
                title={t('settings.language.title')}
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {t('settings.language.label')}
                        </label>
                        <select
                            value={selectedLanguage}
                            onChange={(e) => {
                                const language = normalizeLanguageCode(e.target.value);
                                setSelectedLanguage(language);
                                setLanguageCode(language);
                            }}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                            {LANGUAGE_OPTIONS.map((option) => (
                                <option key={option.code} value={option.code}>
                                    {option.label} ({option.nativeLabel})
                                </option>
                            ))}
                        </select>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('settings.language.hint')}
                    </p>
                    <Button type="button" variant="primary" onClick={onSaveLanguage} disabled={loadingLanguage}>
                        {loadingLanguage ? t('common.states.saving') : t('common.actions.save')}
                    </Button>
                </div>
            </SettingsCard>

            <SettingsCard
                icon={darkMode ? Moon : Sun}
                title={t('settings.appearance.title')}
            >
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.appearance.darkMode')}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {darkModeManual === null
                                    ? t('settings.appearance.followingSystem', {
                                        mode: getSystemDarkMode() ? t('settings.appearance.systemDark') : t('settings.appearance.systemLight'),
                                    })
                                    : darkMode ? t('settings.appearance.manualDark') : t('settings.appearance.manualLight')
                                }
                            </p>
                        </div>
                        <button
                            onClick={toggleDarkMode}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${darkMode ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                            role="switch"
                            aria-checked={darkMode}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${darkMode ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                    </div>
                    {darkModeManual !== null && (
                        <button
                            onClick={resetToSystemDarkMode}
                            className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                        >
                            {t('settings.appearance.resetSystem')}
                        </button>
                    )}
                </div>
            </SettingsCard>

            <SettingsCard
                icon={Bell}
                title={t('settings.notifications.title')}
            >
                <div className="space-y-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('settings.notifications.description')}
                    </p>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {t('settings.notifications.enabled')}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {t('settings.notifications.enabledHint')}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => updateNotificationPreference({ enabled: !notificationPreferences.enabled })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${notificationPreferences.enabled ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                            role="switch"
                            aria-checked={notificationPreferences.enabled}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationPreferences.enabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {t('settings.notifications.paymentDueAlerts')}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {t('settings.notifications.paymentDueAlertsHint')}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => updateNotificationPreference({ paymentDueAlertsEnabled: !notificationPreferences.paymentDueAlertsEnabled })}
                            disabled={!notificationPreferences.enabled}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 ${notificationPreferences.paymentDueAlertsEnabled ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                            role="switch"
                            aria-checked={notificationPreferences.paymentDueAlertsEnabled}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationPreferences.paymentDueAlertsEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {t('settings.notifications.dailyReminder')}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {t('settings.notifications.dailyReminderHint')}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => updateNotificationPreference({ dailyExpenseReminderEnabled: !notificationPreferences.dailyExpenseReminderEnabled })}
                            disabled={!notificationPreferences.enabled}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 ${notificationPreferences.dailyExpenseReminderEnabled ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                            role="switch"
                            aria-checked={notificationPreferences.dailyExpenseReminderEnabled}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationPreferences.dailyExpenseReminderEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {t('settings.notifications.dailyReminderTime')}
                        </label>
                        <input
                            type="time"
                            value={notificationPreferences.dailyExpenseReminderTime || DEFAULT_DAILY_REMINDER_TIME}
                            onChange={(e) => updateNotificationPreference({ dailyExpenseReminderTime: e.target.value })}
                            disabled={!notificationPreferences.enabled || !notificationPreferences.dailyExpenseReminderEnabled}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
                        />
                    </div>

                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {t('settings.notifications.permissionStatusLabel')}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {notificationPermission === 'granted'
                                ? t('settings.notifications.permissionGranted')
                                : notificationPermission === 'denied'
                                    ? t('settings.notifications.permissionDenied')
                                    : notificationPermission === 'unsupported'
                                        ? t('settings.notifications.permissionUnsupported')
                                        : t('settings.notifications.permissionDefault')}
                        </p>
                        {notificationPermission !== 'granted' && notificationPermission !== 'unsupported' && (
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={onRequestNotificationPermission}
                                className="mt-3"
                            >
                                {t('settings.notifications.requestPermission')}
                            </Button>
                        )}
                    </div>

                    <Button
                        type="button"
                        variant="primary"
                        onClick={onSaveNotifications}
                        disabled={loadingNotifications}
                    >
                        {loadingNotifications ? t('settings.notifications.saving') : t('settings.notifications.save')}
                    </Button>
                </div>
            </SettingsCard>

            <SettingsCard
                icon={Key}
                title={t('prefs.aiScanning.title')}
            >
                <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t('prefs.aiScanning.privacy')}</p>
                <div className="mb-3 divide-y divide-gray-100 dark:divide-gray-700">
                    <ToggleRow label={t('prefs.aiScanning.saveImages')} hint={t('prefs.aiScanning.saveImagesHint')} checked={scanPrefs.saveImages} onChange={(v) => setScanPrefsState(setScanPrefs({ saveImages: v }))} />
                    <ToggleRow label={t('prefs.aiScanning.readItems')} hint={t('prefs.aiScanning.readItemsHint')} checked={scanPrefs.readItems} onChange={(v) => setScanPrefsState(setScanPrefs({ readItems: v }))} />
                </div>
                <AiBoundarySettings prefs={scanPrefs} onChange={(patch) => setScanPrefsState(setScanPrefs(patch))} />
                <details className="group">
                    <summary className="flex items-center justify-between min-h-[44px] cursor-pointer select-none text-sm font-medium text-gray-900 dark:text-white">
                        {t('settings.ocr.advanced')}
                        <ChevronDown size={16} className="text-gray-500 dark:text-gray-400 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="pt-2">
                        <form onSubmit={handleSubmit(onSaveApiKey)} className="space-y-4">
                            <Input
                                label={t('settings.ocr.apiKeyLabel')}
                                type="text"
                                placeholder={t('settings.ocr.placeholder')}
                                {...register('ocrApiKey')}
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                {t('settings.ocr.hint')}{' '}
                                <a
                                    href="https://ocr.space/ocrapi"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary-600 dark:text-primary-400 hover:underline"
                                >
                                    ocr.space
                                </a>
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.ocr.note')}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.ocr.originHint')}
                            </p>
                            <Button type="submit" variant="primary" disabled={loading}>
                                {loading ? t('settings.ocr.saving') : t('settings.ocr.save')}
                            </Button>
                        </form>
                    </div>
                </details>
            </SettingsCard>

            <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
            <SettingsCard
                icon={Cloud}
                title={t('prefs.data.title')}
            >
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    {t('settings.cloud.description')}
                </p>
                <div className="space-y-3">
                    <Button
                        variant="primary"
                        onClick={handleSync}
                        disabled={syncing}
                        className="w-full flex items-center justify-center gap-2"
                    >
                        <Cloud size={18} />
                        {syncing ? t('settings.cloud.syncing') : t('settings.cloud.syncButton')}
                    </Button>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('settings.cloud.syncHint')}
                    </p>
                    <Button
                        variant="secondary"
                        onClick={() => setShowClearResyncConfirm(true)}
                        disabled={syncing}
                        className="w-full flex items-center justify-center gap-2"
                    >
                        <Database size={18} />
                        {t('prefs.data.clearCache')}
                    </Button>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('settings.cloud.clearResyncHint')}
                    </p>
                    {syncStatus && (
                        <p className={`text-xs mt-2 ${syncStatus.type === 'success' ? 'text-green-600 dark:text-green-400' :
                            syncStatus.type === 'warning' ? 'text-yellow-600 dark:text-yellow-400' :
                                'text-red-600 dark:text-red-400'
                            }`}>
                            {syncStatus.message}
                        </p>
                    )}
                </div>
                <div className="mt-4 space-y-3 border-t border-gray-100 pt-4 dark:border-gray-700">
                    <Button variant="secondary" onClick={() => setImportOpen(true)} className="w-full flex items-center justify-center gap-2">
                        <Upload size={18} />
                        {t('csvImport.settingsButton')}
                    </Button>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('csvImport.settingsHint')}</p>
                    <Button variant="secondary" onClick={handleExportCsv} className="w-full flex items-center justify-center gap-2">
                        <Download size={18} />
                        {t('prefs.data.exportCsv')}
                    </Button>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('prefs.data.exportHint')}</p>
                    <Button variant="secondary" onClick={handleRecalculateBase} disabled={recalculating} className="w-full flex items-center justify-center gap-2">
                        <RefreshCw size={18} />
                        {recalculating ? t('fx.recalculating') : t('fx.recalcBase')}
                    </Button>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('fx.recalcHint')}</p>
                    {demoReceiptCount > 0 && (
                        <Button variant="secondary" onClick={() => setShowClearDemoConfirm(true)} disabled={clearingDemo} className="w-full">
                            {clearingDemo ? t('settings.demo.clearing') : t('prefs.data.removeSample', { count: demoReceiptCount })}
                        </Button>
                    )}
                </div>
            </SettingsCard>

            <PayCycleSettings />

            <DataSafety />

            <SettingsCard
                icon={Tag}
                title={t('settings.categories.title')}
            >
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    {t('settings.categories.description')}
                </p>

                <div className="space-y-3 mb-4">
                    {customCategories.map(category => (
                        <div key={category.id} className="flex items-center gap-2 p-2 border border-gray-200 dark:border-gray-700 rounded-lg">
                            <div
                                className="w-6 h-6 rounded-full flex-shrink-0 color-swatch"
                                style={{ backgroundColor: category.color || '#00573f' }}
                            />
                            <span className="flex-1 font-medium dark:text-gray-200">{category.name}</span>
                            <button
                                onClick={() => {
                                    setEditingCategory(category);
                                    setNewCategoryName(category.name);
                                    setNewCategoryColor(category.color || '#00573f');
                                }}
                                className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                            >
                                <Edit2 size={16} />
                            </button>
                            <button
                                onClick={() => {
                                    setCategoryToDelete(category);
                                    setShowDeleteCategoryConfirm(true);
                                }}
                                className="p-1 text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                </div>

                <div className="border-t dark:border-gray-700 pt-4">
                    <div className="flex gap-2 mb-2 items-start">
                        <div className="flex-1">
                            <Input
                                placeholder={t('settings.categories.namePlaceholder')}
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                            />
                        </div>
                        <input
                            type="color"
                            value={newCategoryColor}
                            onChange={(e) => setNewCategoryColor(e.target.value)}
                            className="w-12 h-[42px] rounded border border-gray-300 dark:border-gray-600 cursor-pointer mt-0"
                        />
                    </div>
                    <div className="flex gap-2">
                        {editingCategory ? (
                            <>
                                <Button
                                    variant="primary"
                                    onClick={async () => {
                                        if (!newCategoryName.trim()) {
                                            showToast(t('settings.categories.required'), 'error');
                                            return;
                                        }
                                        try {
                                            await updateCategory(editingCategory.id, {
                                                name: newCategoryName.trim(),
                                                color: newCategoryColor
                                            });
                                            setEditingCategory(null);
                                            setNewCategoryName('');
                                            setNewCategoryColor('#00573f');
                                            showToast(t('settings.categories.updateSuccess'), 'success');
                                        } catch (err) {
                                            showToast(t('settings.categories.updateFailed', { message: err.message }), 'error');
                                        }
                                    }}
                                    className="flex-1"
                                >
                                    {t('common.actions.update')}
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        setEditingCategory(null);
                                        setNewCategoryName('');
                                        setNewCategoryColor('#00573f');
                                    }}
                                >
                                    {t('common.actions.cancel')}
                                </Button>
                            </>
                        ) : (
                            <Button
                                variant="primary"
                                onClick={async () => {
                                    if (!newCategoryName.trim()) {
                                        showToast(t('settings.categories.required'), 'error');
                                        return;
                                    }
                                    if (!currentUser) return;
                                    try {
                                        await createCategory({
                                            name: newCategoryName.trim(),
                                            color: newCategoryColor
                                        });
                                        setNewCategoryName('');
                                        setNewCategoryColor('#00573f');
                                        showToast(t('settings.categories.createSuccess'), 'success');
                                    } catch (err) {
                                        showToast(t('settings.categories.createFailed', { message: err.message }), 'error');
                                    }
                                }}
                                className="w-full flex items-center justify-center gap-2"
                            >
                                <Plus size={18} />
                                {t('settings.categories.addCategory')}
                            </Button>
                        )}
                    </div>
                </div>
            </SettingsCard>

            <SettingsCard
                icon={Info}
                title={t('prefs.about.title')}
            >
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('prefs.about.name')}</p>
                <div className="mt-2 flex gap-4 text-sm">
                    <a href="/privacy.html" className="inline-flex min-h-[44px] items-center text-primary-600 hover:underline dark:text-primary-400">{t('prefs.about.privacy')}</a>
                    <a href="/terms.html" className="inline-flex min-h-[44px] items-center text-primary-600 hover:underline dark:text-primary-400">{t('prefs.about.terms')}</a>
                </div>
            </SettingsCard>

            {/* Confirmation Modals */}
            <ConfirmationModal
                isOpen={showLoadDemoConfirm}
                onClose={() => setShowLoadDemoConfirm(false)}
                onConfirm={handleLoadDemoData}
                title={t('settings.demo.loadTitle')}
                message={t('settings.demo.loadMessage')}
                confirmText={t('settings.demo.loadConfirm')}
                cancelText={t('common.actions.cancel')}
            />

            <ConfirmationModal
                isOpen={showClearDemoConfirm}
                onClose={() => setShowClearDemoConfirm(false)}
                onConfirm={handleClearDemoData}
                title={t('settings.demo.clearTitle')}
                message={t('settings.demo.clearMessage')}
                confirmText={t('settings.demo.clearConfirm')}
                cancelText={t('common.actions.cancel')}
                danger={true}
            />

            <ConfirmationModal
                isOpen={showClearResyncConfirm}
                onClose={() => setShowClearResyncConfirm(false)}
                onConfirm={handleClearAndResync}
                title={t('settings.cloud.clearResyncTitle')}
                message={t('settings.cloud.clearResyncMessage')}
                confirmText={t('settings.cloud.clearResyncConfirm')}
                cancelText={t('common.actions.cancel')}
                danger={true}
            />

            <ConfirmationModal
                isOpen={showLogoutConfirm}
                onClose={() => setShowLogoutConfirm(false)}
                onConfirm={handleLogout}
                title={t('settings.account.logoutTitle')}
                message={t('settings.account.logoutMessage')}
                confirmText={t('settings.account.logout')}
                cancelText={t('common.actions.cancel')}
                danger={true}
            />

            <ConfirmationModal
                isOpen={showDeleteCategoryConfirm}
                onClose={() => {
                    setShowDeleteCategoryConfirm(false);
                    setCategoryToDelete(null);
                }}
                onConfirm={async () => {
                    if (!categoryToDelete) return;
                    try {
                        await deleteCategory(categoryToDelete.id);
                        showToast(t('settings.categories.deleteSuccess'), 'success');
                    } catch (err) {
                        showToast(t('settings.categories.deleteFailed', { message: err.message }), 'error');
                    }
                }}
                title={t('settings.categories.deleteTitle')}
                message={t('settings.categories.deleteMessage', { name: categoryToDelete?.name || '' })}
                confirmText={t('common.actions.delete')}
                cancelText={t('common.actions.cancel')}
                danger={true}
            />
        </div>
    );
}
