import { useNavigate } from 'react-router-dom';
import Button from '../components/common/Button';
import { useTranslation } from '../languages/useTranslation';

export default function LandingPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 text-white">
            <div className="max-w-4xl mx-auto px-4 py-12">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="text-6xl mb-4">💰</div>
                    <h1 className="text-4xl font-bold mb-3">{t('auth.landing.title')}</h1>
                    <p className="text-xl opacity-90">{t('auth.landing.subtitle')}</p>
                </div>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
                    <Button
                        variant="secondary"
                        size="lg"
                        onClick={() => navigate('/login')}
                        className="bg-white text-primary-600 hover:bg-gray-100 px-8 py-3 text-lg font-semibold"
                    >
                        {t('auth.landing.signIn')}
                    </Button>
                    <Button
                        variant="secondary"
                        size="lg"
                        onClick={() => navigate('/register')}
                        className="bg-transparent border-2 border-white text-white hover:bg-white/10 px-8 py-3 text-lg font-semibold"
                    >
                        {t('auth.landing.createAccount')}
                    </Button>
                </div>

                {/* Features */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-16">
                    <div className="bg-white/10 rounded-xl p-6">
                        <h3 className="text-lg font-semibold mb-2">📸 {t('auth.landing.features.ocrTitle')}</h3>
                        <p className="opacity-85">{t('auth.landing.features.ocrBody')}</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-6">
                        <h3 className="text-lg font-semibold mb-2">📊 {t('auth.landing.features.analyticsTitle')}</h3>
                        <p className="opacity-85">{t('auth.landing.features.analyticsBody')}</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-6">
                        <h3 className="text-lg font-semibold mb-2">🔄 {t('auth.landing.features.cloudTitle')}</h3>
                        <p className="opacity-85">{t('auth.landing.features.cloudBody')}</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-6">
                        <h3 className="text-lg font-semibold mb-2">📱 {t('auth.landing.features.offlineTitle')}</h3>
                        <p className="opacity-85">{t('auth.landing.features.offlineBody')}</p>
                    </div>
                </div>

                {/* About Section */}
                <div className="text-center mb-12">
                    <h2 className="text-2xl font-bold mb-4">{t('auth.landing.aboutTitle')}</h2>
                    <p className="opacity-90 max-w-2xl mx-auto leading-relaxed">
                        {t('auth.landing.aboutBody')}
                    </p>
                </div>

                {/* Footer */}
                <div className="text-center pt-8 border-t border-white/20">
                    <div className="flex justify-center gap-6 mb-4">
                        <a href="/privacy.html" className="opacity-80 hover:opacity-100 underline">{t('auth.landing.privacy')}</a>
                        <a href="/terms.html" className="opacity-80 hover:opacity-100 underline">{t('auth.landing.terms')}</a>
                    </div>
                    <p className="opacity-70 text-sm">&copy; 2024 Where My Money Went? {t('auth.landing.rights')}</p>
                </div>
            </div>
        </div>
    );
}
