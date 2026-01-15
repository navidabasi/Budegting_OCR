import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import { LogOut, Database, Key, DollarSign, Cloud, UploadCloud, DownloadCloud } from 'lucide-react';

export default function SettingsPage() {
    const currentUser = useAppStore((state) => state.currentUser);
    const logout = useAppStore((state) => state.logout);
    const showToast = useAppStore((state) => state.showToast);
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

    useEffect(() => {
        loadSettings();
    }, [currentUser]);

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

        if (!confirm('This will add sample receipts to your account. Continue?')) {
            return;
        }

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

        if (!confirm('This will remove all demo receipts. Continue?')) {
            return;
        }

        try {
            await storageService.clearDemoData(currentUser.userId);
            showToast('Demo data cleared', 'success');
            setTimeout(() => window.location.reload(), 1000);
        } catch (err) {
            showToast('Failed to clear demo data', 'error');
        }
    };

    const handleSyncToCloud = async () => {
        console.log('[Settings] Sync to cloud clicked, currentUser:', currentUser);
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
            console.log('[Settings] Starting sync to cloud for userId:', currentUser.userId);
            const result = await storageService.syncAllToCloud(currentUser.userId);
            clearTimeout(syncTimeout); // Clear timeout if sync completes
            console.log('[Settings] Sync to cloud result:', result);
            if (result.errors.length > 0) {
                showToast(`Synced ${result.synced} items. ${result.errors.length} errors occurred.`, 'warning');
                setSyncStatus({ type: 'warning', message: `${result.synced} synced, ${result.errors.length} errors` });
            } else {
                showToast(`Successfully synced ${result.synced} items to cloud`, 'success');
                setSyncStatus({ type: 'success', message: `${result.synced} items synced` });
            }
        } catch (err) {
            clearTimeout(syncTimeout); // Clear timeout on error
            console.error('[Settings] Sync to cloud error:', err);
            showToast(`Failed to sync: ${err.message || 'Unknown error'}`, 'error');
            setSyncStatus({ type: 'error', message: 'Sync failed' });
        } finally {
            setSyncing(false);
        }
    };

    const handleSyncFromCloud = async () => {
        console.log('[Settings] Sync from cloud clicked, currentUser:', currentUser);
        if (!currentUser) {
            showToast('Please log in to sync', 'error');
            return;
        }

        // Use window.confirm with fallback - some mobile browsers don't support it
        let shouldSync = true;
        try {
            shouldSync = window.confirm('This will download data from cloud and may overwrite local changes. Continue?');
        } catch (e) {
            // If confirm throws, just proceed
            console.warn('[Settings] confirm() not supported, proceeding anyway');
        }

        if (!shouldSync) {
            console.log('[Settings] User cancelled sync from cloud');
            return;
        }

        setSyncing(true);
        setSyncStatus(null);

        // Add a global timeout for the entire sync operation (30 seconds)
        const syncTimeout = setTimeout(() => {
            console.error('[Settings] Sync from cloud operation timed out after 30 seconds');
            showToast('Sync timed out. Please try again.', 'error');
            setSyncStatus({ type: 'error', message: 'Sync timed out' });
            setSyncing(false);
        }, 30000);

        try {
            console.log('[Settings] Starting sync from cloud for userId:', currentUser.userId);
            const result = await storageService.syncAllFromCloud(currentUser.userId);
            clearTimeout(syncTimeout); // Clear timeout if sync completes
            console.log('[Settings] Sync from cloud result:', result);
            if (result.errors.length > 0) {
                showToast(`Synced ${result.synced} items. ${result.errors.length} errors occurred.`, 'warning');
                setSyncStatus({ type: 'warning', message: `${result.synced} synced, ${result.errors.length} errors` });
            } else {
                showToast(`Successfully synced ${result.synced} items from cloud`, 'success');
                setSyncStatus({ type: 'success', message: `${result.synced} items synced` });
                // Reload the page to show synced data
                setTimeout(() => window.location.reload(), 1000);
            }
        } catch (err) {
            clearTimeout(syncTimeout); // Clear timeout on error
            console.error('[Settings] Sync from cloud error:', err);
            showToast(`Failed to sync: ${err.message || 'Unknown error'}`, 'error');
            setSyncStatus({ type: 'error', message: 'Sync failed' });
        } finally {
            setSyncing(false);
        }
    };

    const handleLogout = async () => {
        console.log('[Settings] Logout clicked');

        // Use window.confirm with fallback
        let shouldLogout = true;
        try {
            shouldLogout = window.confirm('Are you sure you want to logout?');
        } catch (e) {
            // If confirm throws, just proceed
            console.warn('[Settings] confirm() not supported, proceeding with logout');
        }

        if (!shouldLogout) {
            console.log('[Settings] User cancelled logout');
            return;
        }

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

            <div className="card">
                <div className="flex items-center gap-3 mb-4">
                    <Key className="text-primary-600" size={20} />
                    <h3 className="font-semibold">OCR API Key (Optional)</h3>
                </div>
                <form onSubmit={handleSubmit(onSaveApiKey)} className="space-y-4">
                    <Input
                        label="API Key"
                        type="text"
                        placeholder="Enter your OCR.Space API key (optional)"
                        {...register('ocrApiKey')}
                    />
                    <p className="text-xs text-gray-500 mb-2">
                        OCR works without an API key using the free tier. Add your own key for higher limits (25,000 requests/month). Get one at{' '}
                        <a
                            href="https://ocr.space/ocrapi"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-600 hover:underline"
                        >
                            ocr.space
                        </a>
                    </p>
                    <p className="text-xs text-gray-500">
                        <strong>Note:</strong> Leave empty to use the free tier, or enter your API key for higher limits.
                    </p>
                    <Button type="submit" variant="primary" disabled={loading}>
                        {loading ? 'Saving...' : 'Save API Key'}
                    </Button>
                </form>
            </div>

            <div className="card">
                <div className="flex items-center gap-3 mb-4">
                    <DollarSign className="text-primary-600" size={20} />
                    <h3 className="font-semibold">Default Currency</h3>
                </div>
                <form onSubmit={handleSubmitCurrency(onSaveCurrency)} className="space-y-4">
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Currency
                        </label>
                        <Controller
                            name="defaultCurrency"
                            control={controlCurrency}
                            rules={{ required: true }}
                            render={({ field }) => (
                                <select
                                    {...field}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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
                    <p className="text-xs text-gray-500">
                        This currency will be used as default for all new transactions. You can change the currency for individual transactions.
                    </p>
                    <Button type="submit" variant="primary" disabled={loadingCurrency}>
                        {loadingCurrency ? 'Saving...' : 'Save Currency'}
                    </Button>
                </form>
            </div>

            <div className="card">
                <div className="flex items-center gap-3 mb-4">
                    <Cloud className="text-primary-600" size={20} />
                    <h3 className="font-semibold">Cloud Sync</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                    Sync your data with the cloud to access it from multiple devices
                </p>
                <div className="space-y-2">
                    <Button
                        variant="primary"
                        onClick={handleSyncToCloud}
                        disabled={syncing}
                        className="w-full flex items-center justify-center gap-2"
                    >
                        <UploadCloud size={18} />
                        {syncing ? 'Syncing...' : 'Sync to Cloud'}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleSyncFromCloud}
                        disabled={syncing}
                        className="w-full flex items-center justify-center gap-2"
                    >
                        <DownloadCloud size={18} />
                        {syncing ? 'Syncing...' : 'Sync from Cloud'}
                    </Button>
                    {syncStatus && (
                        <p className={`text-xs mt-2 ${syncStatus.type === 'success' ? 'text-green-600' :
                            syncStatus.type === 'warning' ? 'text-yellow-600' :
                                'text-red-600'
                            }`}>
                            {syncStatus.message}
                        </p>
                    )}
                </div>
            </div>

            <div className="card">
                <div className="flex items-center gap-3 mb-4">
                    <Database className="text-primary-600" size={20} />
                    <h3 className="font-semibold">Demo Data</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                    Load sample receipts to see how the app works
                </p>
                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        onClick={handleLoadDemoData}
                        disabled={loadingDemo}
                        className="flex-1"
                    >
                        {loadingDemo ? 'Loading...' : 'Load Demo Data'}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleClearDemoData}
                        className="flex-1"
                    >
                        Clear Demo Data
                    </Button>
                </div>
            </div>

            <div className="card">
                <div className="flex items-center gap-3 mb-4">
                    <LogOut className="text-red-600" size={20} />
                    <h3 className="font-semibold">Account</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                    Signed in as: <span className="font-medium">{currentUser?.email}</span>
                </p>
                <Button variant="danger" onClick={handleLogout} className="w-full">
                    Logout
                </Button>
            </div>
        </div>
    );
}

