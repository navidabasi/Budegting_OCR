import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { authService } from '../services/authService';
import { storageService } from '../services/storage';
import { useAppStore } from '../store/appStore';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import AuthLayout from '../components/common/AuthLayout';
import Divider from '../components/common/Divider';
import GoogleButton from '../components/common/GoogleButton';
import Card from '../components/common/Card';
import { useTranslation } from '../languages/useTranslation';

export default function LoginPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const setCurrentUser = useAppStore((state) => state.setCurrentUser);
    const showToast = useAppStore((state) => state.showToast);
    const { register, handleSubmit, formState: { errors } } = useForm();
    const [loading, setLoading] = useState(false);

    const localizeAuthError = (message) => {
        if (!message) return t('errors.generic');
        const normalized = String(message).toLowerCase();
        if (normalized.includes('email and password are required')) return t('errors.requiredEmailPassword');
        if (normalized.includes('invalid email format')) return t('errors.invalidEmail');
        if (normalized.includes('password must be at least')) return t('errors.passwordMin');
        if (normalized.includes('invalid email or password') || normalized.includes('invalid login credentials')) {
            return t('errors.loginInvalid');
        }
        if (normalized.includes('already exists') || normalized.includes('already registered')) return t('errors.userExists');
        if (normalized.includes('authentication is not configured')) return t('errors.authNotConfigured');
        if (normalized.includes('not authenticated')) return t('errors.notAuthenticated');
        return message;
    };

    const onSubmit = async (data) => {
        setLoading(true);
        try {
            const user = await authService.login(data.email, data.password);
            setCurrentUser(user);
            showToast(t('auth.login.success'), 'success');
            
            // Force sync from cloud on login
            try {
                const result = await storageService.syncAllFromCloud(user.userId);
                if (result.synced > 0) {
                    showToast(
                        t('auth.login.syncFromCloud', {
                            count: result.synced,
                            suffix: result.synced > 1 ? 's' : '',
                        }),
                        'success'
                    );
                }
            } catch (syncError) {
                console.error('Failed to sync from cloud on login:', syncError);
                // Don't show error to user, just log it - sync will retry automatically
            }
            
            navigate('/');
        } catch (err) {
            showToast(localizeAuthError(err.message), 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout
            title={t('auth.login.title')}
            subtitle={t('auth.login.subtitle')}
        >
            <Card>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <Input
                        label={t('common.labels.email')}
                        type="email"
                        {...register('email', {
                            required: t('errors.requiredEmailPassword'),
                            pattern: {
                                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                                message: t('errors.invalidEmail')
                            }
                        })}
                        error={errors.email?.message}
                    />

                    <Input
                        label={t('common.labels.password')}
                        type="password"
                        {...register('password', { required: t('errors.requiredEmailPassword') })}
                        error={errors.password?.message}
                    />

                    <Button
                        type="submit"
                        variant="primary"
                        className="w-full"
                        disabled={loading}
                    >
                        {loading ? t('auth.login.signingIn') : t('auth.login.signIn')}
                    </Button>
                </form>

                <div className="mt-6">
                    <Divider />

                    <GoogleButton
                        onClick={async () => {
                            try {
                                setLoading(true);
                                await authService.signInWithGoogle({ intent: 'signin' });
                            } catch (err) {
                                showToast(err.message || t('auth.callback.unableSignIn'), 'error');
                                setLoading(false);
                            }
                        }}
                        disabled={loading}
                    >
                        {t('auth.login.googleSignIn')}
                    </GoogleButton>
                </div>

                <div className="mt-6 text-center">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        {t('auth.login.noAccount')}{' '}
                        <Link to="/register" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium">
                            {t('auth.login.signUp')}
                        </Link>
                    </p>
                </div>
            </Card>
        </AuthLayout>
    );
}
