import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import ConfirmationModal from '../components/common/ConfirmationModal';
import SettingsCard from '../components/common/SettingsCard';
import { LogOut, Database, Key, DollarSign, Cloud, Tag, Plus, Trash2, Edit2, Moon, Sun, Globe } from 'lucide-react';
import { detectDeviceLanguage, LANGUAGE_OPTIONS, normalizeLanguageCode } from '../languages';
import { useTranslation } from '../languages/useTranslation';

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
    const [apiKey, setApiKey] = useState('');
    const [defaultCurrency, setDefaultCurrency] = useState('EUR');
    const [loading, setLoading] = useState(false);
    const [loadingCurrency, setLoadingCurrency] = useState(false);
    const [loadingLanguage, setLoadingLanguage] = useState(false);
    const [loadingDemo, setLoadingDemo] = useState(false);
    const [clearingDemo, setClearingDemo] = useState(false);
    const [demoReceiptCount, setDemoReceiptCount] = useState(0);
    const [syncing, setSyncing] = useState(false);
    const [syncStatus, setSyncStatus] = useState(null);
    const [showClearResyncConfirm, setShowClearResyncConfirm] = useState(false);
    const [showLoadDemoConfirm, setShowLoadDemoConfirm] = useState(false);
    const [showClearDemoConfirm, setShowClearDemoConfirm] = useState(false);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [showDeleteCategoryConfirm, setShowDeleteCategoryConfirm] = useState(false);
    const [categoryToDelete, setCategoryToDelete] = useState(null);
    const [customCategories, setCustomCategories] = useState([]);
    const [editingCategory, setEditingCategory] = useState(null);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryColor, setNewCategoryColor] = useState('#00573f');
    const [selectedLanguage, setSelectedLanguage] = useState(detectDeviceLanguage());

    useEffect(() => {
        loadSettings();
        loadCustomCategories();
        loadDemoReceiptCount();
    }, [currentUser]);

    useEffect(() => {
        const handleReceiptRefresh = () => {
            loadDemoReceiptCount();
        };

        window.addEventListener('refreshReceipts', handleReceiptRefresh);
        return () => {
            window.removeEventListener('refreshReceipts', handleReceiptRefresh);
        };
    }, [currentUser]);

    const loadCustomCategories = async () => {
        if (!currentUser) return;
        try {
            const categories = await storageService.getUserCategories(currentUser.userId);
            setCustomCategories(categories);
        } catch (err) {
            console.error('Failed to load custom categories:', err);
        }
    };

    const loadSettings = async () => {
        if (!currentUser) return;

        try {
            const settings = await storageService.getSettings(currentUser.userId);
            // Check both ocrApiKey and legacy veryfiApiKey
            const existingApiKey = settings?.ocrApiKey || settings?.veryfiApiKey || '';
            if (existingApiKey) {
                setApiKey(existingApiKey);
                setValue('ocrApiKey', existingApiKey);
            }
            const currency = await storageService.getDefaultCurrency(currentUser.userId);
            setDefaultCurrency(currency);
            resetCurrency({ defaultCurrency: currency });
            const language = normalizeLanguageCode(settings?.languageCode || '', '');
            setSelectedLanguage(language || detectDeviceLanguage());
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    };

    const loadDemoReceiptCount = async () => {
        if (!currentUser) {
            setDemoReceiptCount(0);
            return;
        }

        try {
            const count = await storageService.getDemoReceiptCount(currentUser.userId);
            setDemoReceiptCount(count);
        } catch (err) {
            console.error('Failed to load demo receipt count:', err);
        }
    };

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
            // Ensure userId is a string
            const userId = String(currentUser.userId);
            await storageService.setOcrApiKey(userId, apiKeyValue);
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
            await storageService.setDefaultCurrency(currentUser.userId, currency);
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
            await storageService.setLanguage(currentUser.userId, normalizedLanguage);
            setLanguageCode(normalizedLanguage);
            showToast(t('settings.language.saveSuccess'), 'success');
        } catch (err) {
            console.error('Failed to save language:', err);
            showToast(t('settings.language.saveFailed'), 'error');
        } finally {
            setLoadingLanguage(false);
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
            const result = await storageService.seedDemoData(currentUser.userId);

            if (result.alreadyExists) {
                showToast(t('settings.demo.alreadyLoaded'), 'info');
            } else {
                showToast(t('settings.demo.loadedSuccess', { count: result.importedCount }), 'success');
            }

            await loadDemoReceiptCount();
            window.dispatchEvent(new CustomEvent('refreshDashboard'));
            window.dispatchEvent(new CustomEvent('refreshReceipts'));
            window.dispatchEvent(new CustomEvent('refreshGroups'));
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
            const clearedCount = await storageService.clearDemoData(currentUser.userId);
            showToast(t('settings.demo.clearSuccess'), 'success');
            if (clearedCount > 0) {
                window.dispatchEvent(new CustomEvent('refreshDashboard'));
                window.dispatchEvent(new CustomEvent('refreshReceipts'));
                window.dispatchEvent(new CustomEvent('refreshGroups'));
            }
            await loadDemoReceiptCount();
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
            const result = await storageService.syncBidirectional(currentUser.userId);
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

            // Always trigger refresh events to ensure UI is up to date
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('refreshDashboard'));
                window.dispatchEvent(new CustomEvent('refreshReceipts'));
                window.dispatchEvent(new CustomEvent('refreshGroups'));
            }, 200);
            await loadDemoReceiptCount();
        } catch (err) {
            clearTimeout(syncTimeout); // Clear timeout on error
            console.error('[Settings] Sync error:', err);
            showToast(t('settings.cloud.syncFailed', { message: err.message || 'Unknown error' }), 'error');
            setSyncStatus({ type: 'error', message: t('settings.cloud.syncFailed', { message: err.message || 'Unknown error' }) });
        } finally {
            setSyncing(false);
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
            const result = await storageService.clearAndResync(currentUser.userId);
            console.log('[Settings] Clear and resync result:', result);

            if (result.errors && result.errors.length > 0) {
                console.error('[Settings] Clear and resync errors:', result.errors);
                showToast(t('settings.cloud.resyncWarning'), 'warning');
                setSyncStatus({ type: 'warning', message: t('settings.cloud.resyncWarning') });
            } else {
                showToast(t('settings.cloud.resyncSuccess'), 'success');
                setSyncStatus({ type: 'success', message: t('settings.cloud.resyncSuccess') });
            }

            // Refresh the UI
            window.dispatchEvent(new Event('refreshReceipts'));
            window.dispatchEvent(new Event('refreshGroups'));
            window.dispatchEvent(new Event('refreshDashboard'));
            await loadDemoReceiptCount();
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
                icon={Key}
                title={t('settings.ocr.title')}
            >
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
                icon={Cloud}
                title={t('settings.cloud.title')}
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
                        {t('settings.cloud.clearResyncButton')}
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
            </SettingsCard>

            <SettingsCard
                icon={Database}
                title={t('settings.demo.title')}
            >
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    {t('settings.demo.description')}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                    {demoReceiptCount > 0
                        ? t('settings.demo.loadedCount', {
                            count: demoReceiptCount,
                            suffix: demoReceiptCount !== 1 ? 's' : '',
                        })
                        : t('settings.demo.empty')}
                </p>
                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        onClick={() => setShowLoadDemoConfirm(true)}
                        disabled={loadingDemo || clearingDemo || demoReceiptCount > 0}
                        className="flex-1"
                    >
                        {loadingDemo ? t('settings.demo.loading') : t('settings.demo.loadButton')}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => setShowClearDemoConfirm(true)}
                        disabled={loadingDemo || clearingDemo || demoReceiptCount === 0}
                        className="flex-1"
                    >
                        {clearingDemo ? t('settings.demo.clearing') : t('settings.demo.clearButton')}
                    </Button>
                </div>
            </SettingsCard>

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
                                            await storageService.updateUserCategory(editingCategory.id, {
                                                name: newCategoryName.trim(),
                                                color: newCategoryColor
                                            });
                                            await loadCustomCategories();
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
                                        await storageService.createUserCategory(currentUser.userId, {
                                            name: newCategoryName.trim(),
                                            color: newCategoryColor
                                        });
                                        await loadCustomCategories();
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
                icon={LogOut}
                title={t('settings.account.title')}
                iconColor="text-red-600 dark:text-red-400"
            >
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    {t('settings.account.signedInAs', { email: currentUser?.email || '' })}
                </p>
                <Button variant="danger" onClick={() => setShowLogoutConfirm(true)} className="w-full">
                    {t('settings.account.logout')}
                </Button>
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
                        await storageService.deleteUserCategory(categoryToDelete.id);
                        await loadCustomCategories();
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
