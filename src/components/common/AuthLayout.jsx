/**
 * AuthLayout - Reusable layout for authentication pages (Login, Register)
 * Provides centered layout with card container
 */
export default function AuthLayout({ title, subtitle, children }) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
            <div className="max-w-md w-full">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="text-gray-600 dark:text-gray-400">
                            {subtitle}
                        </p>
                    )}
                </div>
                {children}
            </div>
        </div>
    );
}
