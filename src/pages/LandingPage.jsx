import { useNavigate } from 'react-router-dom';
import Button from '../components/common/Button';

export default function LandingPage() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 text-white">
            <div className="max-w-4xl mx-auto px-4 py-12">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="text-6xl mb-4">💰</div>
                    <h1 className="text-4xl font-bold mb-3">Where My Money Went?</h1>
                    <p className="text-xl opacity-90">Track your expenses effortlessly with OCR-powered receipt scanning</p>
                </div>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
                    <Button
                        variant="secondary"
                        size="lg"
                        onClick={() => navigate('/login')}
                        className="bg-white text-primary-600 hover:bg-gray-100 px-8 py-3 text-lg font-semibold"
                    >
                        Sign In
                    </Button>
                    <Button
                        variant="secondary"
                        size="lg"
                        onClick={() => navigate('/register')}
                        className="bg-transparent border-2 border-white text-white hover:bg-white/10 px-8 py-3 text-lg font-semibold"
                    >
                        Create Account
                    </Button>
                </div>

                {/* Features */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-16">
                    <div className="bg-white/10 rounded-xl p-6">
                        <h3 className="text-lg font-semibold mb-2">📸 OCR Scanning</h3>
                        <p className="opacity-85">Snap a photo of your receipt and let AI extract the details automatically.</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-6">
                        <h3 className="text-lg font-semibold mb-2">📊 Visual Analytics</h3>
                        <p className="opacity-85">See where your money goes with beautiful charts and insights.</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-6">
                        <h3 className="text-lg font-semibold mb-2">🔄 Cloud Sync</h3>
                        <p className="opacity-85">Access your data from any device with secure cloud synchronization.</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-6">
                        <h3 className="text-lg font-semibold mb-2">📱 Works Offline</h3>
                        <p className="opacity-85">Full functionality even without internet. Data syncs when you're back online.</p>
                    </div>
                </div>

                {/* About Section */}
                <div className="text-center mb-12">
                    <h2 className="text-2xl font-bold mb-4">About Where My Money Went?</h2>
                    <p className="opacity-90 max-w-2xl mx-auto leading-relaxed">
                        Where My Money Went? is a personal finance application designed to help you track and manage your expenses.
                        Simply scan your receipts using our OCR technology, categorize your spending, and gain insights into your
                        financial habits. Your data is stored securely and syncs across all your devices.
                    </p>
                </div>

                {/* Footer */}
                <div className="text-center pt-8 border-t border-white/20">
                    <div className="flex justify-center gap-6 mb-4">
                        <a href="/privacy.html" className="opacity-80 hover:opacity-100 underline">Privacy Policy</a>
                        <a href="/terms.html" className="opacity-80 hover:opacity-100 underline">Terms of Service</a>
                    </div>
                    <p className="opacity-70 text-sm">&copy; 2024 Where My Money Went? All rights reserved.</p>
                </div>
            </div>
        </div>
    );
}
