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

export default function LoginPage() {
    const navigate = useNavigate();
    const setCurrentUser = useAppStore((state) => state.setCurrentUser);
    const showToast = useAppStore((state) => state.showToast);
    const { register, handleSubmit, formState: { errors } } = useForm();
    const [loading, setLoading] = useState(false);

    const onSubmit = async (data) => {
        setLoading(true);
        try {
            const user = await authService.login(data.email, data.password);
            setCurrentUser(user);
            showToast('Login successful', 'success');
            
            // Force sync from cloud on login
            try {
                const result = await storageService.syncAllFromCloud(user.userId);
                if (result.synced > 0) {
                    showToast(`Synced ${result.synced} item${result.synced > 1 ? 's' : ''} from cloud`, 'success');
                }
            } catch (syncError) {
                console.error('Failed to sync from cloud on login:', syncError);
                // Don't show error to user, just log it - sync will retry automatically
            }
            
            navigate('/');
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout
            title="Receipt Manager"
            subtitle="Sign in to your account"
        >
            <Card>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <Input
                        label="Email"
                        type="email"
                        {...register('email', {
                            required: 'Email is required',
                            pattern: {
                                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                                message: 'Invalid email format'
                            }
                        })}
                        error={errors.email?.message}
                    />

                    <Input
                        label="Password"
                        type="password"
                        {...register('password', { required: 'Password is required' })}
                        error={errors.password?.message}
                    />

                    <Button
                        type="submit"
                        variant="primary"
                        className="w-full"
                        disabled={loading}
                    >
                        {loading ? 'Signing in...' : 'Sign In'}
                    </Button>
                </form>

                <div className="mt-6">
                    <Divider />

                    <GoogleButton
                        onClick={async () => {
                            try {
                                setLoading(true);
                                await authService.signInWithGoogle();
                            } catch (err) {
                                showToast(err.message || 'Failed to sign in with Google', 'error');
                                setLoading(false);
                            }
                        }}
                        disabled={loading}
                    >
                        Sign in with Google
                    </GoogleButton>
                </div>

                <div className="mt-6 text-center">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Don't have an account?{' '}
                        <Link to="/register" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium">
                            Sign up
                        </Link>
                    </p>
                </div>
            </Card>
        </AuthLayout>
    );
}

