import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { authService } from '../services/authService';
import { useAppStore } from '../store/appStore';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import AuthLayout from '../components/common/AuthLayout';
import Divider from '../components/common/Divider';
import GoogleButton from '../components/common/GoogleButton';
import Card from '../components/common/Card';
import { useTranslation } from '../languages/useTranslation';

export default function RegisterPage() {
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
            const ocrApiKey = data.ocrApiKey?.trim() || null;
            const user = await authService.register(data.email, data.password, ocrApiKey);
            setCurrentUser(user);
            showToast(t('auth.register.success'), 'success');
            navigate('/');
        } catch (err) {
            showToast(localizeAuthError(err.message), 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout
            title={t('auth.register.title')}
            subtitle={t('auth.register.subtitle')}
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
                        {...register('password', {
                            required: t('errors.requiredEmailPassword'),
                            minLength: {
                                value: 6,
                                message: t('errors.passwordMin')
                            }
                        })}
                        error={errors.password?.message}
                    />

                    <div>
                        <Input
                            label={t('auth.register.apiKeyLabel')}
                            type="text"
                            placeholder={t('auth.register.apiKeyPlaceholder')}
                            {...register('ocrApiKey')}
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {t('auth.register.apiKeyHint')}
                        </p>
                    </div>

                    <Button
                        type="submit"
                        variant="primary"
                        className="w-full"
                        disabled={loading}
                    >
                        {loading ? t('auth.register.creatingAccount') : t('auth.register.createAccount')}
                    </Button>
                </form>

                <div className="mt-6">
                    <Divider />

                    <GoogleButton
                        onClick={async () => {
                            try {
                                setLoading(true);
                                await authService.signUpWithGoogle();
                            } catch (err) {
                                showToast(err.message || t('auth.callback.unableSignUp'), 'error');
                                setLoading(false);
                            }
                        }}
                        disabled={loading}
                    >
                        {t('auth.register.googleSignUp')}
                    </GoogleButton>
                </div>

                <div className="mt-6 text-center">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        {t('auth.register.haveAccount')}{' '}
                        <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium">
                            {t('auth.register.signIn')}
                        </Link>
                    </p>
                </div>
            </Card>
        </AuthLayout>
    );
}
