import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import ConfirmationModal from '../components/common/ConfirmationModal';
import SettingsCard from '../components/common/SettingsCard';
import { LogOut, Database, Key, DollarSign, Cloud, Tag, Plus, Trash2, Edit2, Moon, Sun } from 'lucide-react';

export default function SettingsPage() {
    const currentUser = useAppStore((state) => state.currentUser);
    const logout = useAppStore((state) => state.logout);
    const showToast = useAppStore((state) => state.showToast);
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
    const [loadingDemo, setLoadingDemo] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncStatus, setSyncStatus] = useState(null);
    const [showLoadDemoConfirm, setShowLoadDemoConfirm] = useState(false);
    const [showClearDemoConfirm, setShowClearDemoConfirm] = useState(false);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [showDeleteCategoryConfirm, setShowDeleteCategoryConfirm] = useState(false);
    const [categoryToDelete, setCategoryToDelete] = useState(null);
    const [customCategories, setCustomCategories] = useState([]);
    const [editingCategory, setEditingCategory] = useState(null);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryColor, setNewCategoryColor] = useState('#00573f');

    useEffect(() => {
        loadSettings();
        loadCustomCategories();
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
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    };

    const onSaveApiKey = async (data) => {
        if (!currentUser) {
            showToast('User not logged in', 'error');
            return;
        }

        if (!currentUser.userId) {
            showToast('Invalid user ID', 'error');
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
            showToast('API key saved successfully', 'success');
        } catch (err) {
            console.error('Error saving API key:', err);
            console.error('currentUser:', currentUser);
            showToast(`Failed to save API key: ${err.message || 'Unknown error'}`, 'error');
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
            showToast('Default currency saved successfully', 'success');
        } catch (err) {
            console.error('Failed to save currency:', err);
            showToast('Failed to save currency', 'error');
        } finally {
            setLoadingCurrency(false);
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
        try {
            const count = await storageService.seedDemoData(currentUser.userId);
            showToast(`Loaded ${count} demo receipts`, 'success');
            // Reload the page to show new data
            setTimeout(() => window.location.reload(), 1000);
        } catch (err) {
            showToast('Failed to load demo data', 'error');
        } finally {
            setLoadingDemo(false);
        }
    };

    const handleClearDemoData = async () => {
        if (!currentUser) return;

        try {
            await storageService.clearDemoData(currentUser.userId);
            showToast('Demo data cleared', 'success');
            setTimeout(() => window.location.reload(), 1000);
        } catch (err) {
            showToast('Failed to clear demo data', 'error');
        }
    };

    const handleSync = async () => {
        console.log('[Settings] Sync clicked, currentUser:', currentUser);
        if (!currentUser) {
            showToast('Please log in to sync', 'error');
            return;
        }

        setSyncing(true);
        setSyncStatus(null);

        // Add a global timeout for the entire sync operation (30 seconds)
        const syncTimeout = setTimeout(() => {
            console.error('[Settings] Sync operation timed out after 30 seconds');
            showToast('Sync timed out. Please try again.', 'error');
            setSyncStatus({ type: 'error', message: 'Sync timed out' });
            setSyncing(false);
        }, 30000);

        try {
            console.log('[Settings] Starting bidirectional sync for userId:', currentUser.userId);
            const result = await storageService.syncBidirectional(currentUser.userId);
            clearTimeout(syncTimeout); // Clear timeout if sync completes
            console.log('[Settings] Sync result:', result);

            let message = '';
            let statusType = 'success';

            if (result.conflicts && result.conflicts.length > 0) {
                message = `Synced ${result.synced} items. ${result.conflicts.length} conflict(s) merged automatically.`;
                statusType = 'warning';
            } else if (result.errors.length > 0) {
                const firstError = result.errors[0];
                const errorMsg = firstError.error || firstError.message || 'Unknown error';
                message = `Synced ${result.synced} items. ${result.errors.length} error(s): ${errorMsg}`;
                statusType = 'error';
                console.error('[Settings] Sync errors:', result.errors);
            } else {
                message = `Successfully synced ${result.synced} items`;
                statusType = 'success';
            }

            showToast(message, statusType);
            setSyncStatus({ type: statusType, message });

            // Reload if items were synced to show updated data
            if (result.synced > 0) {
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('refreshDashboard'));
                    window.dispatchEvent(new CustomEvent('refreshReceipts'));
                }, 500);
            }
        } catch (err) {
            clearTimeout(syncTimeout); // Clear timeout on error
            console.error('[Settings] Sync error:', err);
            showToast(`Failed to sync: ${err.message || 'Unknown error'}`, 'error');
            setSyncStatus({ type: 'error', message: 'Sync failed' });
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
                title="OCR API Key (Optional)"
            >
                <form onSubmit={handleSubmit(onSaveApiKey)} className="space-y-4">
                    <Input
                        label="API Key"
                        type="text"
                        placeholder="Enter your OCR.Space API key (optional)"
                        {...register('ocrApiKey')}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                        OCR works without an API key using the free tier. Add your own key for higher limits (25,000 requests/month). Get one at{' '}
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
                        <strong>Note:</strong> Leave empty to use the free tier, or enter your API key for higher limits.
                    </p>
                    <Button type="submit" variant="primary" disabled={loading}>
                        {loading ? 'Saving...' : 'Save API Key'}
                    </Button>
                </form>
            </SettingsCard>

            <SettingsCard
                icon={DollarSign}
                title="Default Currency"
            >
                <form onSubmit={handleSubmitCurrency(onSaveCurrency)} className="space-y-4">
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Currency
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
                        This currency will be used as default for all new transactions. You can change the currency for individual transactions.
                    </p>
                    <Button type="submit" variant="primary" disabled={loadingCurrency}>
                        {loadingCurrency ? 'Saving...' : 'Save Currency'}
                    </Button>
                </form>
            </SettingsCard>

            <SettingsCard
                icon={darkMode ? Moon : Sun}
                title="Appearance"
            >
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Dark Mode</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {darkModeManual === null
                                    ? `Following system (${getSystemDarkMode() ? 'Dark' : 'Light'})`
                                    : darkMode ? 'Manually set to Dark' : 'Manually set to Light'
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
                            Reset to system preference
                        </button>
                    )}
                </div>
            </SettingsCard>

            <SettingsCard
                icon={Cloud}
                title="Cloud Sync"
            >
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Sync your data with the cloud to access it from multiple devices
                </p>
                <div className="space-y-2">
                    <Button
                        variant="primary"
                        onClick={handleSync}
                        disabled={syncing}
                        className="w-full flex items-center justify-center gap-2"
                    >
                        <Cloud size={18} />
                        {syncing ? 'Syncing...' : 'Sync'}
                    </Button>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Syncs both directions automatically. If the same receipt was changed on both devices, changes will be merged (line items combined, newer data preserved).
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
                title="Demo Data"
            >
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Load sample receipts to see how the app works
                </p>
                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        onClick={() => setShowLoadDemoConfirm(true)}
                        disabled={loadingDemo}
                        className="flex-1"
                    >
                        {loadingDemo ? 'Loading...' : 'Load Demo Data'}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => setShowClearDemoConfirm(true)}
                        className="flex-1"
                    >
                        Clear Demo Data
                    </Button>
                </div>
            </SettingsCard>

            <SettingsCard
                icon={Tag}
                title="Custom Categories"
            >
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Create custom categories that sync across all your devices
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
                                placeholder="Category name"
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
                                            showToast('Category name is required', 'error');
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
                                            showToast('Category updated', 'success');
                                        } catch (err) {
                                            showToast(`Failed to update: ${err.message}`, 'error');
                                        }
                                    }}
                                    className="flex-1"
                                >
                                    Update
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        setEditingCategory(null);
                                        setNewCategoryName('');
                                        setNewCategoryColor('#00573f');
                                    }}
                                >
                                    Cancel
                                </Button>
                            </>
                        ) : (
                            <Button
                                variant="primary"
                                onClick={async () => {
                                    if (!newCategoryName.trim()) {
                                        showToast('Category name is required', 'error');
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
                                        showToast('Category created', 'success');
                                    } catch (err) {
                                        showToast(`Failed to create: ${err.message}`, 'error');
                                    }
                                }}
                                className="w-full flex items-center justify-center gap-2"
                            >
                                <Plus size={18} />
                                Add Category
                            </Button>
                        )}
                    </div>
                </div>
            </SettingsCard>

            <SettingsCard
                icon={LogOut}
                title="Account"
                iconColor="text-red-600 dark:text-red-400"
            >
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Signed in as: <span className="font-medium">{currentUser?.email}</span>
                </p>
                <Button variant="danger" onClick={() => setShowLogoutConfirm(true)} className="w-full">
                    Logout
                </Button>
            </SettingsCard>

            {/* Confirmation Modals */}
            <ConfirmationModal
                isOpen={showLoadDemoConfirm}
                onClose={() => setShowLoadDemoConfirm(false)}
                onConfirm={handleLoadDemoData}
                title="Load Demo Data"
                message="This will add sample receipts to your account. Continue?"
                confirmText="Load"
                cancelText="Cancel"
            />

            <ConfirmationModal
                isOpen={showClearDemoConfirm}
                onClose={() => setShowClearDemoConfirm(false)}
                onConfirm={handleClearDemoData}
                title="Clear Demo Data"
                message="This will remove all demo receipts. Continue?"
                confirmText="Clear"
                cancelText="Cancel"
                danger={true}
            />

            <ConfirmationModal
                isOpen={showLogoutConfirm}
                onClose={() => setShowLogoutConfirm(false)}
                onConfirm={handleLogout}
                title="Logout"
                message="Are you sure you want to logout?"
                confirmText="Logout"
                cancelText="Cancel"
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
                        showToast('Category deleted', 'success');
                    } catch (err) {
                        showToast(`Failed to delete: ${err.message}`, 'error');
                    }
                }}
                title="Delete Category"
                message={`Delete category "${categoryToDelete?.name}"?`}
                confirmText="Delete"
                cancelText="Cancel"
                danger={true}
            />
        </div>
    );
}
