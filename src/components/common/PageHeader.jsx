/**
 * PageHeader - Reusable page header component
 * Displays title, optional subtitle, and action buttons
 */
export default function PageHeader({ 
    title, 
    subtitle, 
    actions = null,
    className = '' 
}) {
    return (
        <div className={`mb-8 ${className}`}>
            <div className="flex items-center justify-between mb-1 gap-4">
                <div className="min-w-0">
                    {title && (
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                            {title}
                        </h1>
                    )}
                    {subtitle && (
                        <p className="text-sm text-gray-500 dark:text-gray-300">
                            {subtitle}
                        </p>
                    )}
                </div>
                {actions && (
                    <div className="flex flex-shrink-0 flex-wrap gap-2 justify-end">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
}
