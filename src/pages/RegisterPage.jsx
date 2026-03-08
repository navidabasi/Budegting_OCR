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

export default function RegisterPage() {
    const navigate = useNavigate();
    const setCurrentUser = useAppStore((state) => state.setCurrentUser);
    const showToast = useAppStore((state) => state.showToast);
    const { register, handleSubmit, formState: { errors } } = useForm();
    const [loading, setLoading] = useState(false);

    const onSubmit = async (data) => {
        setLoading(true);
        try {
            const ocrApiKey = data.ocrApiKey?.trim() || null;
            const user = await authService.register(data.email, data.password, ocrApiKey);
            setCurrentUser(user);
            showToast('Registration successful', 'success');
            navigate('/');
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout
            title="Create Account"
            subtitle="Sign up to start managing your receipts"
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
                        {...register('password', {
                            required: 'Password is required',
                            minLength: {
                                value: 6,
                                message: 'Password must be at least 6 characters'
                            }
                        })}
                        error={errors.password?.message}
                    />

                    <div>
                        <Input
                            label="OCR API Key (Optional)"
                            type="text"
                            placeholder="Leave empty to use server default (if configured)"
                            {...register('ocrApiKey')}
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            If no server default key is configured, add your OCR.Space key here or in Settings.
                        </p>
                    </div>

                    <Button
                        type="submit"
                        variant="primary"
                        className="w-full"
                        disabled={loading}
                    >
                        {loading ? 'Creating account...' : 'Create Account'}
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
                                showToast(err.message || 'Failed to sign up with Google', 'error');
                                setLoading(false);
                            }
                        }}
                        disabled={loading}
                    >
                        Sign up with Google
                    </GoogleButton>
                </div>

                <div className="mt-6 text-center">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Already have an account?{' '}
                        <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium">
                            Sign in
                        </Link>
                    </p>
                </div>
            </Card>
        </AuthLayout>
    );
}
