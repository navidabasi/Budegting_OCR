import { Loader } from 'lucide-react';

/**
 * LoadingSpinner - Reusable loading spinner component
 * Displays a centered loading spinner with optional message
 */
export default function LoadingSpinner({ 
    message = null, 
    size = 32,
    className = '',
    fullScreen = true 
}) {
    const content = (
        <div className={`flex flex-col items-center justify-center ${fullScreen ? 'min-h-screen' : ''} ${className}`}>
            <Loader className="animate-spin text-primary-600" size={size} />
            {message && (
                <p className="mt-4 text-gray-600 dark:text-gray-400">{message}</p>
            )}
        </div>
    );

    if (fullScreen) {
        return content;
    }

    return content;
}
