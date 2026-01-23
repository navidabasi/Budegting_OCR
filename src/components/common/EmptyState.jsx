/**
 * EmptyState - Reusable empty state component
 * Displays a centered message when there's no content
 */
export default function EmptyState({ 
    message, 
    icon: Icon = null,
    action = null,
    className = '' 
}) {
    return (
        <div className={`card text-center py-12 ${className}`}>
            {Icon && (
                <div className="flex justify-center mb-4">
                    <Icon className="text-gray-400 dark:text-gray-500" size={48} />
                </div>
            )}
            <p className="text-gray-500 dark:text-gray-400 text-lg mb-4">
                {message}
            </p>
            {action && (
                <div className="mt-4">
                    {action}
                </div>
            )}
        </div>
    );
}
