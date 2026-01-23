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
            <div className="flex items-start justify-between mb-1">
                <div>
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
                    <div className="flex gap-2">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
}
