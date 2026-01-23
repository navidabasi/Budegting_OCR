/**
 * Divider - Reusable divider component with text
 * Used for "Or continue with" sections in forms
 */
export default function Divider({ text = 'Or continue with' }) {
    return (
        <div className="relative">
            <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
            </div>
            <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    {text}
                </span>
            </div>
        </div>
    );
}
